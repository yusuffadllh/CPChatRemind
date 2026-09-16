import { DateTime } from 'luxon';
import { config } from './config.js';
import { formatLead } from './duration.js';
import { logger } from './logger.js';
import {
  nextFire,
  readReminders,
  updateReminder,
  type Reminder,
} from './reminders.js';
import { readTasks, updateTask, type Task } from './tasks.js';
import { formatMoment } from './time.js';
import { sendText } from './whatsapp.js';

const log = logger.child({ module: 'scheduler' });

/** Cek tiap detik supaya pengingat tidak menunggu sampai menit berikutnya. */
const SWEEP_MS = 1_000;
/** Kirim sedikit lebih awal agar waktu di WhatsApp tidak lewat jadwal. */
const SEND_EARLY_MS = 1_000;

/** Isi pesan pengingat. Sengaja menyebut taksirannya biar salah taksir kelihatan. */
function reminderText(task: Task, minutesLeft: number): string {
  // Di bawah 4 jam nadanya diubah, biar pengingat terakhir tidak terlihat sama
  // dengan yang pertama.
  const head = minutesLeft <= 240 ? `⚠️ *${task.title}*` : `🎯 *${task.title}*`;

  const info = [
    head,
    `⏰ Tenggat ${formatMoment(task.deadline)}`,
    minutesLeft > 0 ? `⏳ Sisa ${formatLead(minutesLeft)}` : '⏳ Sudah lewat tenggat',
    `📊 Kesulitan ${task.difficulty}/5 · perkiraan ${formatLead(task.workMinutes)} kerja`,
    ...(task.reason ? [`_${task.reason}_`] : []),
  ].join('\n');

  const body = task.body.trim();
  return body ? `${info}\n\n${body}` : info;
}

/**
 * Kirim lapisan yang sudah waktunya.
 *
 * Lapisan yang telat tetap dikirim selama tenggatnya belum lewat (permintaan
 * pengguna: "dikirim aja asal blm dl"). Begitu tenggat lewat, sisa lapisan
 * ditandai skipped dan tugasnya ditutup.
 *
 * `send` bisa diganti supaya logikanya bisa diuji tanpa socket WhatsApp.
 */
export async function sweepOnce(
  send: (jid: string, text: string) => Promise<void> = sendText,
): Promise<void> {
  const tasks = await readTasks();
  const now = DateTime.now().setZone(config.TIMEZONE);

  for (const task of tasks) {
    if (task.status !== 'active') continue;

    const deadline = DateTime.fromISO(task.deadline, { zone: config.TIMEZONE });
    if (!deadline.isValid) {
      log.warn({ taskId: task.id, deadline: task.deadline }, 'tenggat tidak valid, tugas ditutup');
      await updateTask(task.id, (item) => {
        item.status = 'done';
      });
      continue;
    }

    if (now >= deadline) {
      await updateTask(task.id, (item) => {
        for (const layer of item.layers) {
          if (layer.status === 'pending') layer.status = 'skipped';
        }
        item.status = 'done';
      });
      log.info({ taskId: task.id, title: task.title }, 'tenggat lewat, pengingat dihentikan');
      continue;
    }

    const due = task.layers.filter((layer) => {
      if (layer.status !== 'pending') return false;
      const at = DateTime.fromISO(layer.fireAt, { zone: config.TIMEZONE });
      return at.isValid && at.toMillis() - SEND_EARLY_MS <= now.toMillis();
    });
    if (due.length === 0) continue;

    // Kalau beberapa lapisan telat sekaligus (mis. server mati semalam), cukup
    // kirim satu pesan dan tandai sisanya terkirim.
    const minutesLeft = Math.max(Math.round(deadline.diff(now, 'minutes').minutes), 0);

    try {
      await send(task.jid, reminderText(task, minutesLeft));
    } catch (error) {
      // Socket belum siap atau kirim gagal: biarkan pending, coba lagi 1 menit lagi.
      log.warn({ err: error, taskId: task.id }, 'gagal kirim pengingat, dicoba lagi nanti');
      continue;
    }

    const sentAt = now.toISO() ?? '';
    const fired = new Set(due.map((layer) => layer.fireAt));
    await updateTask(task.id, (item) => {
      for (const layer of item.layers) {
        if (layer.status === 'pending' && fired.has(layer.fireAt)) {
          layer.status = 'sent';
          layer.sentAt = sentAt;
        }
      }
    });

    log.info(
      { taskId: task.id, title: task.title, layers: due.length, minutesLeft },
      'pengingat tugas terkirim',
    );
  }
}

/** Isi pesan pengingat rutin. Tidak ada taksiran, cukup judul + detailnya. */
function reminderPingText(reminder: Reminder): string {
  const head = `⏰ *${reminder.title}*`;
  const body = reminder.body.trim();
  return body ? `${head}\n${body}` : head;
}

/**
 * Sapu pengingat WA murni yang waktunya sudah tiba.
 *
 * Beda dari tugas: polanya berulang sampai `stopAt`, jadi setiap sapuan cukup
 * tanya "kapan kirim berikutnya" — kalau jawabannya sudah lewat (termasuk saat
 * server sempat mati), kirim sekarang dan tandai waktunya.
 */
export async function sweepReminders(
  send: (jid: string, text: string) => Promise<void> = sendText,
): Promise<void> {
  const reminders = await readReminders();
  const now = DateTime.now().setZone(config.TIMEZONE);

  for (const reminder of reminders) {
    if (reminder.status !== 'active') continue;

    const stop = DateTime.fromISO(reminder.stopAt, { zone: config.TIMEZONE });
    const invalid =
      !stop.isValid ||
      (reminder.pattern.kind === 'daily' &&
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.pattern.dailyAt));

    if (invalid || now > stop) {
      await updateReminder(reminder.id, (item) => {
        item.status = 'done';
      });
      log.info(
        { reminderId: reminder.id, title: reminder.title, reason: invalid ? 'pola tidak valid' : 'masa berlaku habis' },
        'pengingat rutin ditutup',
      );
      continue;
    }

    const fireAt = nextFire(reminder, now);
    if (!fireAt || fireAt.toMillis() - SEND_EARLY_MS > now.toMillis()) continue;

    try {
      await send(reminder.jid, reminderPingText(reminder));
    } catch (error) {
      log.warn({ err: error, reminderId: reminder.id }, 'gagal kirim pengingat rutin, dicoba lagi nanti');
      continue;
    }

    await updateReminder(reminder.id, (item) => {
      item.lastSentAt = now.toISO() ?? '';
    });
    log.info({ reminderId: reminder.id, title: reminder.title }, 'pengingat rutin terkirim');
  }
}

/** Jalankan sapuan berkala. Dipanggil sekali dari index.ts setelah WA siap. */
export function startScheduler(): void {
  const tick = (): void => {
    void sweepOnce().catch((error) => {
      log.error({ err: error }, 'sapuan pengingat gagal');
    });
    void sweepReminders().catch((error) => {
      log.error({ err: error }, 'sapuan pengingat rutin gagal');
    });
  };

  // Jalankan sekali saat scheduler aktif, lalu sejajarkan tick berikutnya ke
  // detik penuh agar pemeriksaan waktunya konsisten.
  tick();
  const delay = SWEEP_MS - (Date.now() % SWEEP_MS);
  setTimeout(() => {
    tick();
    // unref supaya timer tidak menahan proses saat shutdown.
    setInterval(tick, SWEEP_MS).unref();
  }, delay).unref();
  log.info({ everySeconds: SWEEP_MS / 1000 }, 'penjadwal pengingat tugas aktif');
}
