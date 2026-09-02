import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { WASocket } from 'baileys';
import { createEvent } from './caldav.js';
import { parseCommand, runCommand } from './commands.js';
import { config, isWhitelisted } from './config.js';
import { describeAlarm, normalizeReminder } from './duration.js';
import { extract, parseLocal } from './gemini.js';
import { logger } from './logger.js';
import { saveNote } from './notes.js';
import { react, reply, type IncomingMessage } from './whatsapp.js';

const EMOJI = {
  working: '⏳',
  event: '📅',
  note: '📝',
  ignored: '🤷',
  failed: '❌',
  read: '📖',
} as const;

/** Pesan yang sedang diproses, biar kiriman ganda tidak dobel dikerjakan. */
const inFlight = new Set<string>();

function isAllowed(message: IncomingMessage): boolean {
  if (message.isSelfChat) return config.ALLOW_SELF_CHAT;
  return isWhitelisted(message.senderPhone);
}

/** Buang prefix kata kunci; null berarti pesan tidak lolos filter. */
function stripKeyword(text: string): string | null {
  if (!config.REQUIRE_KEYWORD) return text;

  const lower = text.toLowerCase();
  const hit = config.KEYWORDS.find((keyword) => {
    if (!lower.startsWith(keyword)) return false;
    // Batas kata, supaya "/catatan" tidak dianggap "/catat" + "an".
    const next = lower[keyword.length];
    return next === undefined || !/[\p{L}\p{N}]/u.test(next);
  });
  if (!hit) return null;

  // Buang pemisah setelah kata kunci, mis. "/catat: beli beras".
  const rest = text.slice(hit.length).replace(/^[\s:,.\-–—]+/u, '').trim();
  return rest.length > 0 ? rest : null;
}

export function createHandler(getSocket: () => WASocket) {
  return async function handle(message: IncomingMessage): Promise<void> {
    if (!isAllowed(message)) {
      logger.debug(
        { from: message.senderPhone, isSelfChat: message.isSelfChat },
        'Pengirim tidak diizinkan (cek ALLOW_SELF_CHAT / WHITELIST)',
      );
      return;
    }

    const messageId = message.raw.key.id;
    if (!messageId || inFlight.has(messageId)) return;

    // Perintah baca (/list, /cari, /agenda, /bantuan) dijawab tanpa lewat Gemini.
    const command = parseCommand(message.text);
    if (command) {
      inFlight.add(messageId);
      const log = logger.child({ from: message.senderPhone });
      const sock = getSocket();
      try {
        const answer = await runCommand(command);
        await react(sock, message.raw, EMOJI.read);
        await reply(sock, message.raw, answer);
        log.info({ command: command.name }, 'Perintah dijalankan');
      } catch (error) {
        log.error({ err: error, command: command.name }, 'Perintah gagal');
        await react(sock, message.raw, EMOJI.failed);
      } finally {
        inFlight.delete(messageId);
      }
      return;
    }

    const payload = stripKeyword(message.text);
    if (!payload) {
      logger.debug(
        { text: message.text, keywords: config.KEYWORDS },
        'Pesan tidak lolos filter kata kunci',
      );
      return;
    }

    inFlight.add(messageId);

    const sock = getSocket();
    const log = logger.child({ from: message.senderPhone });

    try {
      await react(sock, message.raw, EMOJI.working);

      const result = await extract(payload, message.senderPhone);
      log.debug({ result }, 'Hasil ekstraksi');

      // Kata kunci eksplisit = perintah langsung, jadi "ignore" dari Gemini
      // tidak boleh membatalkannya (mis. "/catat tes" tetap tersimpan).
      const type = result.type === 'ignore' && config.REQUIRE_KEYWORD ? 'note' : result.type;

      if (type === 'ignore') {
        await react(sock, message.raw, EMOJI.ignored);
        return;
      }

      const start = parseLocal(result.datetime_start);
      const title = result.title.trim() || payload.slice(0, 60);
      const body = result.note?.trim() || payload;

      // Event tanpa waktu tidak bisa masuk kalender, turunkan jadi catatan.
      if (type === 'event' && start) {
        // Menit alarm: ikuti pesan kalau disebut, kalau tidak pakai default .env.
        const reminderMinutes =
          normalizeReminder(result.reminder_minutes_before) ?? config.REMINDER_MINUTES_BEFORE;

        const uid = await createEvent({
          title,
          description: `${body}\n\n— dari WhatsApp: ${message.senderPhone}`,
          location: result.location ?? undefined,
          start,
          end: parseLocal(result.datetime_end),
          allDay: result.all_day,
          reminderMinutes,
        });

        await saveNote({
          id: randomUUID(),
          title,
          body,
          sender: message.senderPhone,
          createdAt: DateTime.now().setZone(config.TIMEZONE).toISO() ?? '',
          eventUid: uid,
          eventStart: start.toISO() ?? '',
          reminderMinutes,
        });

        await react(sock, message.raw, EMOJI.event);
        await reply(
          sock,
          message.raw,
          `📅 *${title}*\n${start.setZone(config.TIMEZONE).setLocale('id').toFormat('ccc, dd LLL yyyy • HH:mm')}\n` +
            describeAlarm(reminderMinutes),
        );
        log.info({ title, reminderMinutes }, 'Event dibuat');
        return;
      }

      await saveNote({
        id: randomUUID(),
        title,
        body,
        sender: message.senderPhone,
        createdAt: DateTime.now().setZone(config.TIMEZONE).toISO() ?? '',
      });

      await react(sock, message.raw, EMOJI.note);
      log.info({ title }, 'Catatan disimpan');
    } catch (error) {
      log.error({ err: error }, 'Gagal memproses pesan');
      await react(sock, message.raw, EMOJI.failed);
      await reply(
        sock,
        message.raw,
        `❌ Gagal: ${error instanceof Error ? error.message : 'kesalahan tak terduga'}`,
      );
    } finally {
      inFlight.delete(messageId);
    }
  };
}
