import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from 'baileys';
import { join } from 'node:path';
import qrcode from 'qrcode-terminal';
import { config, digitsOnly } from './config.js';
import { logger } from './logger.js';

export interface IncomingMessage {
  /** Chat tujuan balasan. */
  jid: string;
  /** Nomor pengirim tanpa suffix domain. */
  senderPhone: string;
  text: string;
  isSelfChat: boolean;
  raw: WAMessage;
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>;

const RECONNECT_DELAY_MS = 3000;

/**
 * Baileys sangat berisik di level info (history sync, app-state, dsb).
 * Dipisah ke level sendiri supaya LOG_LEVEL=debug tetap enak dibaca.
 */
const waLogger = logger.child({ module: 'baileys' }, { level: config.BAILEYS_LOG_LEVEL });

/** Socket bisa diganti saat reconnect, jadi handler harus selalu ambil yang terbaru. */
let current: WASocket | null = null;

export function getSocket(): WASocket {
  if (!current) throw new Error('Socket WhatsApp belum siap');
  return current;
}

/** Ambil teks dari berbagai bentuk pesan yang mungkin. */
function extractText(message: WAMessage): string | null {
  const content = message.message;
  if (!content) return null;

  const text =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    null;

  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * Ambil nomor telepon asli pengirim.
 *
 * WhatsApp kini sering memakai LID (`123@lid`) yang angkanya sama sekali beda
 * dari nomor telepon. Baileys menyertakan nomor aslinya di `key.senderPn` /
 * `key.participantPn`, jadi itu yang dipakai lebih dulu.
 */
function resolveSenderPhone(message: WAMessage): string {
  const key = message.key;
  const candidate = key.senderPn ?? key.participantPn ?? key.participant ?? key.remoteJid ?? '';
  const digits = digitsOnly(jidNormalizedUser(candidate).split('@')[0] ?? '');
  if (digits.length >= 8) return digits;
  return digitsOnly(candidate.split('@')[0] ?? '');
}

/** Bandingkan dua nomor lewat 9 digit terakhir, biar +62.. dan 08.. dianggap sama. */
function sameNumber(a: string, b: string): boolean {
  const left = digitsOnly(a);
  const right = digitsOnly(b);
  if (left.length < 8 || right.length < 8) return false;
  return left.slice(-9) === right.slice(-9);
}

/**
 * Cek apakah chat ini adalah "Message Yourself".
 * Dicocokkan lewat nomor telepon maupun LID, karena WhatsApp bisa memakai
 * salah satu tergantung versi klien.
 */
function isSelfChatJid(sock: WASocket, message: WAMessage): boolean {
  const ownPhone = digitsOnly(jidNormalizedUser(sock.user?.id ?? '').split('@')[0] ?? '');
  const ownLid = digitsOnly(jidNormalizedUser(sock.user?.lid ?? '').split('@')[0] ?? '');

  const jid = message.key.remoteJid ?? '';
  const jidDigits = digitsOnly(jidNormalizedUser(jid).split('@')[0] ?? '');

  if (jid.endsWith('@lid')) {
    if (ownLid && sameNumber(jidDigits, ownLid)) return true;
    // remoteJid berupa LID: nomor aslinya ada di senderPn.
    const senderPn = message.key.senderPn;
    if (senderPn && ownPhone && sameNumber(senderPn, ownPhone)) return true;
    return false;
  }

  return Boolean(ownPhone) && sameNumber(jidDigits, ownPhone);
}

export async function startWhatsApp(onMessage: MessageHandler): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(join(config.DATA_DIR, 'auth'));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger: waLogger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  current = sock;
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('Scan QR ini di WhatsApp → Perangkat tertaut → Tautkan perangkat');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      logger.info({ user: sock.user?.id, lid: sock.user?.lid }, 'WhatsApp tersambung');
    }

    if (connection === 'close') {
      const status = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;

      if (status === DisconnectReason.loggedOut) {
        logger.error(
          `Sesi dicabut dari HP. Hapus folder ${join(config.DATA_DIR, 'auth')} lalu scan QR lagi.`,
        );
        process.exit(1);
      }

      logger.warn({ status }, 'Koneksi terputus, menyambung ulang…');
      setTimeout(() => {
        void startWhatsApp(onMessage).catch((error) => {
          logger.error({ err: error }, 'Gagal menyambung ulang');
        });
      }, RECONNECT_DELAY_MS);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // 'notify' = pesan baru dari orang lain.
    // 'append' = pesan yang kita kirim sendiri dari HP; ini yang dipakai self-chat.
    if (type !== 'notify' && type !== 'append') {
      logger.debug({ type, count: messages.length }, 'Upsert dilewati');
      return;
    }

    for (const message of messages) {
      const jid = message.key.remoteJid;
      if (!jid) continue;

      // Grup, status, dan newsletter tidak diproses.
      if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) {
        continue;
      }

      const isSelfChat = isSelfChatJid(sock, message);
      const text = extractText(message);
      const senderPhone = resolveSenderPhone(message);

      logger.debug(
        {
          type,
          jid,
          senderPn: message.key.senderPn,
          senderPhone,
          fromMe: message.key.fromMe,
          isSelfChat,
          text,
        },
        'Pesan masuk',
      );

      // Pesan keluar hanya relevan kalau ini chat ke diri sendiri.
      if (message.key.fromMe && !isSelfChat) continue;

      if (!text) continue;

      try {
        await onMessage({ jid, senderPhone, text, isSelfChat, raw: message });
      } catch (error) {
        logger.error({ err: error }, 'Gagal memproses pesan');
      }
    }
  });

  return sock;
}

export async function react(sock: WASocket, message: WAMessage, emoji: string): Promise<void> {
  const jid = message.key.remoteJid;
  if (!jid) return;
  try {
    await sock.sendMessage(jid, { react: { text: emoji, key: message.key } });
  } catch (error) {
    logger.warn({ err: error }, 'Gagal mengirim react');
  }
}

export async function reply(sock: WASocket, message: WAMessage, text: string): Promise<void> {
  const jid = message.key.remoteJid;
  if (!jid) return;
  try {
    await sock.sendMessage(jid, { text }, { quoted: message });
  } catch (error) {
    logger.warn({ err: error }, 'Gagal mengirim balasan');
  }
}
