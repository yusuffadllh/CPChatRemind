import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { WASocket } from 'baileys';
import { createEvent } from './caldav.js';
import {
  emptyPayloadHint,
  parseCommand,
  runCommand,
  unknownCommandHint,
} from './commands.js';
import { config, isWhitelisted, MEDIA_KEYWORD, TASK_KEYWORD } from './config.js';
import { describeAlarm, formatLead, normalizeReminder } from './duration.js';
import { estimateDifficulty, extract, parseLocal, readDeadlineAnswer, toReminderRule } from './gemini.js';
import { logger } from './logger.js';
import { formatBytes, mediaTitle, saveMedia, type Attachment } from './media.js';
import { saveNote } from './notes.js';
import { buildTask, saveTask, type ReminderRule, type Task } from './tasks.js';
import { formatMoment } from './time.js';
import { react, reply, type IncomingMessage } from './whatsapp.js';

const EMOJI = {
  working: '⏳',
  event: '📅',
  note: '📝',
  task: '🎯',
  ignored: '🤷',
  failed: '❌',
  read: '📖',
  saved: '💾',
} as const;

/** Pesan yang sedang diproses, biar kiriman ganda tidak dobel dikerjakan. */
const inFlight = new Set<string>();

/**
 * Tugas yang menunggu jawaban konfirmasi tenggat. Sesi kedaluwarsa sendiri
 * setelah beberapa jam supaya tidak menumpuk.
 */
interface PendingDeadline {
  jid: string;
  senderPhone: string;
  title: string;
  body: string;
  attachment?: Attachment;
  askedAt: number;
}
const pendingDeadlines = new Map<string, PendingDeadline>();
const PENDING_TIMEOUT_MS = 6 * 60 * 60 * 1000;

function cleanupPending(): void {
  const cutoff = Date.now() - PENDING_TIMEOUT_MS;
  for (const [key, session] of pendingDeadlines) {
    if (session.askedAt < cutoff) pendingDeadlines.delete(key);
  }
}

/** Pertanyaan lanjutan kalau tenggat tugas tidak jelas atau sudah lewat. */
function askDeadlineHint(title: string, overdue: boolean): string {
  return [
    `📝 *${title}*`,
    overdue
      ? 'Tenggatnya sudah lewat, jadi belum ada pengingat yang kujadwalkan.'
      : 'Tenggatnya belum bisa dijadwalkan karena tidak ada tanggal pastinya.',
    '',
    'Tenggatnya kapan? Balas pakai `/tugas`, contoh:',
    `\`${TASK_KEYWORD} deadline 20 Oktober jam 5 sore\``,
    '',
    'Boleh sekalian minta pola pengingatnya, contoh:',
    `\`${TASK_KEYWORD} deadline Jumat, ingetin tiap jam\``,
    `\`${TASK_KEYWORD} deadline 20 Okt, tiap hari jam 8 pagi\``,
    '',
    'Atau kirim `' + TASK_KEYWORD + ' skip` kalau tidak perlu pengingat.',
  ].join('\n');
}

function isAllowed(message: IncomingMessage): boolean {
  if (message.isSelfChat) return config.ALLOW_SELF_CHAT;
  return isWhitelisted(message.senderPhone);
}

/**
 * Pesan error untuk dikirim balik ke WhatsApp. Detail lengkapnya sudah masuk log,
 * jadi di sini cukup yang enak dibaca: jangan pernah bocorkan JSON mentah atau
 * pesan panjang dari API pihak ketiga.
 */
function userMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'kesalahan tak terduga';
  const text = error.message.trim();
  if (!text || text.length > 160 || text.startsWith('{') || text.startsWith('[')) {
    return 'kesalahan tak terduga, cek log server';
  }
  return text;
}

/** Hasil pembacaan kata kunci di awal pesan. */
type Payload =
  /** Ada teks yang perlu dipahami Gemini. */
  | { kind: 'ok'; text: string; keepFile: boolean; keyword: string | null }
  /** Tidak ada teks, tapi ada foto/video yang bisa langsung disimpan. */
  | { kind: 'media' }
  /** Kata kunci benar tapi tidak ada isinya, mis. cuma "/catat". */
  | { kind: 'empty'; keyword: string }
  /** Bukan untuk bot. */
  | { kind: 'skip' };

/**
 * Buang prefix kata kunci dari pesan.
 *
 * `keepFile` cuma true untuk MEDIA_KEYWORD: kata kunci lain tetap mencatat
 * keterangannya, tapi berkasnya tidak diunduh ke server.
 */
function stripKeyword(text: string, hasMedia: boolean): Payload {
  if (!config.REQUIRE_KEYWORD) {
    const trimmed = text.trim();
    if (trimmed.length > 0) return { kind: 'ok', text: trimmed, keepFile: hasMedia, keyword: null };
    return hasMedia ? { kind: 'media' } : { kind: 'skip' };
  }

  const lower = text.toLowerCase();
  const hit = config.KEYWORDS.find((keyword) => {
    if (!lower.startsWith(keyword)) return false;
    // Batas kata, supaya "/catatan" tidak dianggap "/catat" + "an".
    const next = lower[keyword.length];
    return next === undefined || !/[\p{L}\p{N}]/u.test(next);
  });
  if (!hit) return { kind: 'skip' };

  const keepFile = hasMedia && hit === MEDIA_KEYWORD;

  // Buang pemisah setelah kata kunci, mis. "/catat: beli beras".
  const rest = text.slice(hit.length).replace(/^[\s:,.\-–—]+/u, '').trim();
  if (rest.length > 0) return { kind: 'ok', text: rest, keepFile, keyword: hit };

  // Kata kunci tanpa isi hanya sah kalau memang mau menyimpan berkasnya.
  return keepFile ? { kind: 'media' } : { kind: 'empty', keyword: hit };
}

/** Satu baris keterangan berkas untuk balasan WhatsApp. */
function attachmentLine(attachment: Attachment, quoted = false): string {
  const origin = quoted ? ' _(dari pesan yang dibalas)_' : '';
  return `📎 ${attachment.kind} ${formatBytes(attachment.bytes)} → \`${attachment.path}\`${origin}`;
}

/** Ringkasan tugas + daftar jadwal pengingatnya, biar salah taksir langsung kelihatan. */
function taskSummary(task: Task): string {
  const ruleNote =
    task.reminderRule && task.reminderRule.intervalMinutes
      ? '\n_(ikut permintaanmu, bukan taksiran AI)_'
      : '';

  const head = [
    `🎯 *${task.title}*`,
    `⏰ Tenggat ${formatMoment(task.deadline)}`,
    `📊 Kesulitan ${task.difficulty}/5 · perkiraan ${formatLead(task.workMinutes)} kerja`,
    ...(task.reason ? [`_${task.reason}_`] : []),
  ].join('\n');

  const schedule = [
    `🔔 Aku bakal WA kamu ${task.layers.length}×:${ruleNote}`,
    ...task.layers.map(
      (layer) => `• ${formatMoment(layer.fireAt)} (${formatLead(layer.minutesBefore)} sebelum)`,
    ),
  ].join('\n');

  return [
    head,
    schedule,
    'Kalau taksirannya ngawur, kirim ulang dengan tenggat/detail yang lebih jelas.',
  ].join('\n\n');
}

/** Tugas tanpa tanggal pasti tidak bisa dijadwalkan; jangan mengarang tanggalnya. */
/**
 * Balasan konfirmasi hanya diproses kalau diawali /tugas, biar tidak menelan pesan lain.
 */
function takePendingDeadline(
  message: IncomingMessage,
): { session: PendingDeadline; answer: string } | null {
  cleanupPending();
  const text = message.text.trim();
  if (!text.toLowerCase().startsWith('/tugas')) return null;
  const key = `${message.senderPhone}:${message.jid}`;
  const session = pendingDeadlines.get(key);
  if (!session) return null;

  const answer = text.replace(/^\/tugas\b/i, '').trim();
  // Isi kosong tidak menghabiskan sesi; biarkan jatuh ke petunjuk /tugas kosong.
  if (!answer) return null;

  pendingDeadlines.delete(key);
  return { session, answer };
}

export function createHandler(getSocket: () => WASocket) {
  /**
   * Simpan tugas baru (catatan + jadwal) lalu susun ringkasannya.
   * Dipakai jalur utama dan jalur konfirmasi tenggat; pengirimannya tetap di
   * handle() supaya reaksi dan balasan nempel ke pesan yang benar.
   */
  async function scheduleTask(input: {
    noteId: string;
    jid: string;
    title: string;
    body: string;
    deadline: DateTime;
    reminderRule?: ReminderRule;
  }): Promise<Task> {
    const estimate = await estimateDifficulty(input.title, input.body);
    const task = buildTask({
      noteId: input.noteId,
      jid: input.jid,
      title: input.title,
      body: input.body,
      deadline: input.deadline,
      difficulty: estimate.difficulty,
      workMinutes: estimate.work_minutes,
      reason: estimate.reason,
      reminderRule: input.reminderRule,
    });
    await saveTask(task);
    logger.info(
      {
        title: task.title,
        deadline: task.deadline,
        difficulty: task.difficulty,
        layers: task.layers.length,
        rule: Boolean(input.reminderRule),
      },
      'Tugas dijadwalkan',
    );
    return task;
  }

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

    // Jawaban atas pertanyaan "tenggatnya kapan?" diproses lebih dulu supaya
    // tidak dianggap tugas baru. Harus diawali /tugas dan ada sesi menunggu.
    const pending = takePendingDeadline(message);
    if (pending) {
      inFlight.add(messageId);
      const log = logger.child({ from: message.senderPhone });
      const sock = getSocket();
      try {
        await react(sock, message.raw, EMOJI.working);

        // "skip": pengguna tidak mau melanjutkan pengingatnya.
        if (/\bskip\b/i.test(pending.answer)) {
          await react(sock, message.raw, EMOJI.ignored);
          await reply(sock, message.raw, '👌 Oke, pengingatnya tidak kujadwalkan.');
          log.info('Konfirmasi tenggat dilewati pengguna');
          return;
        }

        const answer = await readDeadlineAnswer(pending.session.body, pending.answer);
        const deadline = parseLocal(answer.datetime_start);
        const rule = toReminderRule(answer.task_reminder_rule);

        if (!deadline || deadline <= DateTime.now().setZone(config.TIMEZONE)) {
          // Masih tidak jelas: sesi sudah dihapus di atas, sesi baru dibuat
          // supaya pengguna bisa mencoba lagi dengan jawaban lain.
          pendingDeadlines.set(`${message.senderPhone}:${message.jid}`, {
            ...pending.session,
            askedAt: Date.now(),
          });
          await react(sock, message.raw, EMOJI.note);
          await reply(
            sock,
            message.raw,
            [
              `🤔 Belum kebaca tanggal pastinya dari "${pending.answer}".`,
              askDeadlineHint(pending.session.title, true),
            ].join('\n\n'),
          );
          return;
        }

        const noteId = randomUUID();
        await saveNote({
          id: noteId,
          title: pending.session.title,
          body: pending.session.body,
          sender: message.senderPhone,
          createdAt: DateTime.now().setZone(config.TIMEZONE).toISO() ?? '',
          eventStart: deadline.toISO() ?? '',
          ...(pending.session.attachment ? { attachment: pending.session.attachment } : {}),
        });

        const task = await scheduleTask({
          noteId,
          jid: pending.session.jid,
          title: pending.session.title,
          body: pending.session.body,
          deadline,
          ...(rule ? { reminderRule: rule } : {}),
        });

        await react(sock, message.raw, EMOJI.task);
        await reply(sock, message.raw, taskSummary(task));
        log.info({ deadline: task.deadline }, 'Tugas dijadwalkan dari jawaban konfirmasi');
      } catch (error) {
        log.error({ err: error }, 'Gagal memproses jawaban tenggat');
        await react(sock, message.raw, EMOJI.failed);
        await reply(sock, message.raw, `❌ Gagal: ${userMessage(error)}`);
      } finally {
        inFlight.delete(messageId);
      }
      return;
    }

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

    const payload = stripKeyword(message.text, Boolean(message.media));
    const sock = getSocket();

    if (payload.kind === 'empty') {
      await react(sock, message.raw, EMOJI.ignored);
      await reply(sock, message.raw, emptyPayloadHint(payload.keyword));
      return;
    }

    if (payload.kind === 'skip') {
      // Diawali "/" tapi bukan perintah yang dikenal: kasih petunjuk, jangan
      // diam saja. Teks biasa tanpa "/" tetap diabaikan tanpa balasan.
      const hint = unknownCommandHint(message.text);
      if (hint) {
        await react(sock, message.raw, EMOJI.ignored);
        await reply(sock, message.raw, hint);
        return;
      }

      logger.debug(
        { text: message.text, keywords: config.KEYWORDS },
        'Pesan tidak lolos filter kata kunci',
      );
      return;
    }

    inFlight.add(messageId);

    const log = logger.child({ from: message.senderPhone });

    try {
      await react(sock, message.raw, EMOJI.working);

      // Berkas diunduh lebih dulu supaya kegagalannya ketahuan sebelum kuota
      // Gemini terpakai. Gagal simpan tidak membatalkan catatan/eventnya.
      let attachment: Attachment | undefined;
      let mediaWarning: string | undefined;

      // Hanya MEDIA_KEYWORD yang menulis berkas ke disk; kata kunci lain
      // memperlakukan foto/video seperti pesan teks biasa.
      const keepFile = payload.kind === 'media' || payload.keepFile;

      if (message.media && keepFile) {
        try {
          attachment = await saveMedia(sock, message.media);
        } catch (error) {
          log.warn({ err: error, kind: message.media.kind }, 'Gagal menyimpan lampiran');
          // Tanpa teks tidak ada sisa pekerjaan, jadi biarkan jatuh ke catch luar.
          if (payload.kind === 'media') throw error;
          mediaWarning = `⚠️ Lampiran tidak tersimpan: ${userMessage(error)}`;
        }
      }

      // Foto/video tanpa keterangan: simpan saja, tidak perlu lewat Gemini.
      if (payload.kind === 'media') {
        const title = mediaTitle(message.media ?? { kind: 'foto' });

        await saveNote({
          id: randomUUID(),
          title,
          body: '',
          sender: message.senderPhone,
          createdAt: DateTime.now().setZone(config.TIMEZONE).toISO() ?? '',
          ...(attachment ? { attachment } : {}),
        });

        await react(sock, message.raw, EMOJI.saved);
        await reply(
          sock,
          message.raw,
          `💾 *${title}*${attachment ? `\n${attachmentLine(attachment, message.media?.quoted)}` : ''}`,
        );
        log.info(
          { title, path: attachment?.path, quoted: message.media?.quoted },
          'Lampiran disimpan tanpa keterangan',
        );
        return;
      }

      const result = await extract(payload.text, message.senderPhone);
      log.debug({ result }, 'Hasil ekstraksi');

      // Aturan pengingat yang pengguna minta eksplisit, mis. "ingetin tiap jam".
      // Hanya berlaku di jalur tugas; /catat dan /ingatkan tidak berubah.
      const requestedRule = toReminderRule(result.task_reminder_rule);

      // Jalur tugas hanya dibuka oleh kata kuncinya sendiri. Tanpa itu, "task"
      // dari Gemini diperlakukan seperti biasa supaya /catat dan /ingatkan tidak
      // berubah perilaku.
      const wantsTask = payload.keyword === TASK_KEYWORD;
      let type: 'event' | 'note' | 'task' | 'ignore' = result.type;
      if (wantsTask) {
        type = 'task';
      } else if (type === 'task') {
        type = result.datetime_start ? 'event' : 'note';
      } else if (type === 'ignore' && config.REQUIRE_KEYWORD) {
        // Kata kunci eksplisit = perintah langsung, jadi "ignore" dari Gemini
        // tidak boleh membatalkannya (mis. "/catat tes" tetap tersimpan).
        type = 'note';
      }

      if (type === 'ignore') {
        await react(sock, message.raw, EMOJI.ignored);
        return;
      }

      const start = parseLocal(result.datetime_start);
      const title = result.title.trim() || payload.text.slice(0, 60);
      const body = result.note?.trim() || payload.text;

      if (type === 'task') {
        const noteId = randomUUID();
        const deadlinePassed = start ? start <= DateTime.now().setZone(config.TIMEZONE) : false;
        const rule = wantsTask ? requestedRule : undefined;

        // Tenggat tidak jelas atau sudah lewat: simpan catatannya lalu tanya
        // langsung lewat chat. Jawabannya (yang juga diawali /tugas) diproses
        // jadi tugas beneran.
        if (!start || deadlinePassed) {
          await saveNote({
            id: noteId,
            title,
            body,
            sender: message.senderPhone,
            createdAt: DateTime.now().setZone(config.TIMEZONE).toISO() ?? '',
            ...(start ? { eventStart: start.toISO() ?? '' } : {}),
            ...(attachment ? { attachment } : {}),
          });

          pendingDeadlines.set(`${message.senderPhone}:${message.jid}`, {
            jid: message.jid,
            senderPhone: message.senderPhone,
            title,
            body,
            ...(attachment ? { attachment } : {}),
            askedAt: Date.now(),
          });

          await react(sock, message.raw, EMOJI.note);
          await reply(
            sock,
            message.raw,
            [
              askDeadlineHint(title, deadlinePassed),
              attachment ? attachmentLine(attachment, message.media?.quoted) : '',
              mediaWarning ?? '',
            ]
              .filter((line) => line.length > 0)
              .join('\n'),
          );
          log.info({ title, deadlinePassed }, 'Menunggu jawaban tenggat lewat chat');
          return;
        }

        const note = {
          id: noteId,
          title,
          body,
          sender: message.senderPhone,
          createdAt: DateTime.now().setZone(config.TIMEZONE).toISO() ?? '',
          eventStart: start.toISO() ?? '',
          ...(attachment ? { attachment } : {}),
        };
        await saveNote(note);

        const task = await scheduleTask({
          noteId,
          jid: message.jid,
          title,
          body,
          deadline: start,
          ...(rule ? { reminderRule: rule } : {}),
        });

        await react(sock, message.raw, EMOJI.task);
        await reply(
          sock,
          message.raw,
          [
            taskSummary(task),
            attachment ? attachmentLine(attachment, message.media?.quoted) : '',
            mediaWarning ?? '',
          ]
            .filter((line) => line.length > 0)
            .join('\n'),
        );
        return;
      }

      // Event tanpa waktu tidak bisa masuk kalender, turunkan jadi catatan.
      if (type === 'event' && start) {
        // Menit alarm: ikuti pesan kalau disebut, kalau tidak pakai default .env.
        const reminderMinutes =
          normalizeReminder(result.reminder_minutes_before) ?? config.REMINDER_MINUTES_BEFORE;

        const uid = await createEvent({
          title,
          description: [
            body,
            attachment ? `Lampiran: ${attachment.path}` : '',
            `— dari WhatsApp: ${message.senderPhone}`,
          ]
            .filter((line) => line.length > 0)
            .join('\n\n'),
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
          ...(attachment ? { attachment } : {}),
        });

        await react(sock, message.raw, EMOJI.event);
        await reply(
          sock,
          message.raw,
          [
            `📅 *${title}*`,
            start.setZone(config.TIMEZONE).setLocale('id').toFormat('ccc, dd LLL yyyy • HH:mm'),
            describeAlarm(reminderMinutes),
            attachment ? attachmentLine(attachment, message.media?.quoted) : '',
            mediaWarning ?? '',
          ]
            .filter((line) => line.length > 0)
            .join('\n'),
        );
        log.info({ title, reminderMinutes, path: attachment?.path }, 'Event dibuat');
        return;
      }

      await saveNote({
        id: randomUUID(),
        title,
        body,
        sender: message.senderPhone,
        createdAt: DateTime.now().setZone(config.TIMEZONE).toISO() ?? '',
        ...(attachment ? { attachment } : {}),
      });

      await react(sock, message.raw, attachment ? EMOJI.saved : EMOJI.note);

      // Catatan teks biasa cukup dibalas reaksi. Kalau ada berkas, lokasinya
      // dilaporkan supaya jelas benar-benar mendarat di server.
      if (attachment || mediaWarning) {
        await reply(
          sock,
          message.raw,
          [
            `💾 *${title}*`,
            attachment ? attachmentLine(attachment, message.media?.quoted) : '',
            mediaWarning ?? '',
          ]
            .filter((line) => line.length > 0)
            .join('\n'),
        );
      }

      log.info({ title, path: attachment?.path }, 'Catatan disimpan');
    } catch (error) {
      log.error({ err: error }, 'Gagal memproses pesan');
      await react(sock, message.raw, EMOJI.failed);
      await reply(sock, message.raw, `❌ Gagal: ${userMessage(error)}`);
    } finally {
      inFlight.delete(messageId);
    }
  };
}
