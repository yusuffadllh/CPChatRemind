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
import { config } from './config.js';
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

const waLogger = logger.child({ module: 'baileys' });

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
      logger.info({ user: sock.user?.id }, 'WhatsApp tersambung');
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
    if (type !== 'notify') return;

    const ownJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;

    for (const message of messages) {
      const jid = message.key.remoteJid;
      if (!jid) continue;

      // Grup, status, dan newsletter tidak diproses.
      if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) {
        continue;
      }

      const normalizedJid = jidNormalizedUser(jid);
      const isSelfChat = ownJid !== null && normalizedJid === ownJid;

      // Pesan keluar hanya relevan kalau ini chat ke diri sendiri.
      if (message.key.fromMe && !isSelfChat) continue;

      const text = extractText(message);
      if (!text) continue;

      const senderPhone = normalizedJid.split('@')[0] ?? '';

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
