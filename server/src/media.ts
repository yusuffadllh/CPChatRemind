import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  downloadMediaMessage,
  normalizeMessageContent,
  type WAMessage,
  type WAMessageContent,
  type WAMessageKey,
  type WASocket,
} from 'baileys';
import { DateTime } from 'luxon';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Hanya foto dan video yang disimpan ke server. Audio, dokumen, dan stiker
 * sengaja tidak ikut supaya folder media tidak jadi tempat sampah.
 */
export type MediaKind = 'foto' | 'video';

/** Info lampiran yang dibaca dari pesan, sebelum berkasnya diunduh. */
export interface MediaInfo {
  kind: MediaKind;
  mimetype: string;
  /** Ukuran menurut pengirim; belum tentu benar, jadi dicek lagi setelah unduh. */
  declaredBytes: number;
  /** true kalau lampiran datang dari pesan yang dibalas, bukan pesan ini sendiri. */
  quoted: boolean;
  /**
   * Pesan yang berkasnya diunduh. Bisa berbeda dari pesan yang masuk kalau
   * pengguna membalas media dengan `/simpan`.
   */
  source: WAMessage;
}

/** Lampiran yang sudah ada di disk. Ikut ditulis ke notes.jsonl. */
export interface Attachment {
  /** Relatif terhadap DATA_DIR, mis. "media/2026-03/20260315-120000-ab12cd34.jpg". */
  path: string;
  kind: MediaKind;
  mimetype: string;
  bytes: number;
}

/** protobufjs memakai Long untuk angka 64-bit, jadi fileLength bisa bukan number. */
type Long64 = { toNumber: () => number };

type MediaFields = {
  mimetype?: string | null;
  fileLength?: number | Long64 | null;
};

const mediaLogger = logger.child({ module: 'media' });

/** Folder lampiran, di dalam DATA_DIR supaya ikut bind mount Docker. */
const MEDIA_DIR = 'media';

/**
 * Ekstensi yang dipercaya. Mimetype dari pengirim tidak boleh langsung jadi
 * ekstensi tanpa disaring dulu.
 */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

function toBytes(value: MediaFields['fileLength']): number {
  if (typeof value === 'number') return value;
  if (value && typeof value.toNumber === 'function') return value.toNumber();
  return 0;
}

function pickMedia(content: WAMessageContent): { kind: MediaKind; media: MediaFields } | null {
  if (content.imageMessage) return { kind: 'foto', media: content.imageMessage };
  if (content.videoMessage) return { kind: 'video', media: content.videoMessage };
  return null;
}

/** Ambil contextInfo dari bentuk pesan apa pun yang bisa membawa balasan. */
function contextInfoOf(content: WAMessageContent) {
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    null
  );
}

/**
 * Bangun WAMessage tiruan untuk media di pesan yang dibalas.
 *
 * Balasan hanya membawa isi pesan aslinya, bukan pesan utuhnya. downloadMediaMessage
 * butuh `key` yang benar supaya bisa minta reupload ke HP kalau medianya kedaluwarsa.
 */
function quotedMessage(
  message: WAMessage,
  content: WAMessageContent,
  isOwnJid: (jid: string) => boolean,
): WAMessage | null {
  const context = contextInfoOf(content);
  const inner = normalizeMessageContent(context?.quotedMessage);
  if (!context || !inner) return null;

  const participant = context.participant ?? undefined;
  const key: WAMessageKey = {
    remoteJid: message.key.remoteJid,
    id: context.stanzaId,
    fromMe: participant ? isOwnJid(participant) : Boolean(message.key.fromMe),
    ...(participant ? { participant } : {}),
  };

  return { key, message: inner, messageTimestamp: message.messageTimestamp };
}

/** null berarti pesan ini tidak punya lampiran yang bisa diunduh. */
export function describeMedia(
  message: WAMessage,
  isOwnJid: (jid: string) => boolean,
): MediaInfo | null {
  // normalizeMessageContent membuka bungkus ephemeral / viewOnce /
  // documentWithCaption, sama seperti yang dilakukan downloadMediaMessage.
  const content = normalizeMessageContent(message.message);
  if (!content) return null;

  const direct = pickMedia(content);
  if (direct) return toInfo(direct, message, false);

  // Tidak ada lampiran langsung: mungkin ini balasan ke foto lama.
  const quoted = quotedMessage(message, content, isOwnJid);
  if (!quoted?.message) return null;

  const picked = pickMedia(quoted.message);
  return picked ? toInfo(picked, quoted, true) : null;
}

/** Rangkum lampiran jadi bentuk yang enak dipakai handler. */
function toInfo(
  picked: { kind: MediaKind; media: MediaFields },
  source: WAMessage,
  quoted: boolean,
): MediaInfo {
  return {
    kind: picked.kind,
    mimetype:
      picked.media.mimetype?.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream',
    declaredBytes: toBytes(picked.media.fileLength),
    quoted,
    source,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function extensionFor(info: MediaInfo): string {
  // Mimetype tak dikenal tetap disimpan, cuma tanpa ekstensi yang berarti.
  return EXTENSIONS[info.mimetype] ?? (info.kind === 'video' ? 'mp4' : 'jpg');
}

/** Judul catatan untuk foto/video yang dikirim tanpa keterangan. */
export function mediaTitle(info: { kind: MediaKind }): string {
  return info.kind === 'video' ? 'Video dari WhatsApp' : 'Foto dari WhatsApp';
}

/**
 * Unduh foto/video lalu tulis ke DATA_DIR/media/<tahun-bulan>/.
 *
 * Nama berkas dibuat sendiri dari waktu + UUID, bukan dari nama kiriman, supaya
 * tidak ada `../` atau karakter aneh yang menembus folder.
 */
export async function saveMedia(sock: WASocket, info: MediaInfo): Promise<Attachment> {
  const cap = config.MEDIA_MAX_MB * 1024 * 1024;
  const tooBig = (bytes: number): Error =>
    new Error(`Berkas ${formatBytes(bytes)} melebihi batas ${config.MEDIA_MAX_MB} MB.`);

  // Ukuran dari pengirim dipakai untuk menolak lebih awal, sebelum buang kuota.
  if (info.declaredBytes > cap) throw tooBig(info.declaredBytes);

  const buffer = await downloadMediaMessage(
    info.source,
    'buffer',
    {},
    {
      logger: mediaLogger,
      // Media yang sudah kedaluwarsa di server WA harus diminta ulang ke HP.
      // Cast karena Baileys memakai tipe proto yang lebih longgar di socket.
      reuploadRequest: async (msg: WAMessage) => (await sock.updateMediaMessage(msg)) as WAMessage,
    },
  );

  // Cek ulang: angka tadi datang dari pengirim, isi sebenarnya bisa beda.
  if (buffer.length > cap) throw tooBig(buffer.length);

  const now = DateTime.now().setZone(config.TIMEZONE);
  const folder = now.toFormat('yyyy-LL');
  const filename = `${now.toFormat('yyyyLLdd-HHmmss')}-${randomUUID().slice(0, 8)}.${extensionFor(info)}`;
  const relative = `${MEDIA_DIR}/${folder}/${filename}`;

  await mkdir(join(config.DATA_DIR, MEDIA_DIR, folder), { recursive: true });
  await writeFile(join(config.DATA_DIR, relative), buffer);

  mediaLogger.info({ path: relative, bytes: buffer.length, kind: info.kind }, 'Lampiran disimpan');

  return {
    path: relative,
    kind: info.kind,
    mimetype: info.mimetype,
    bytes: buffer.length,
  };
}
