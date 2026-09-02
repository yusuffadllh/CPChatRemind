import { DateTime } from 'luxon';
import { config } from './config.js';
import { formatLead } from './duration.js';
import { logger } from './logger.js';
import { readTasks, updateTask, type Task } from './tasks.js';
import { formatMoment } from './time.js';
import { sendText } from './whatsapp.js';

const log = logger.child({ module: 'scheduler' });

/** Sapuan tiap menit; presisi detik tidak penting untuk pengingat tugas. */
const SWEEP_MS = 60_000;

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
      return at.isValid && at <= now;
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

/** Jalankan sapuan berkala. Dipanggil sekali dari index.ts setelah WA siap. */
export function startScheduler(): void {
  const tick = (): void => {
    void sweepOnce().catch((error) => {
      log.error({ err: error }, 'sapuan pengingat gagal');
    });
  };

  // unref supaya timer tidak menahan proses saat shutdown.
  setInterval(tick, SWEEP_MS).unref();
  log.info({ everySeconds: SWEEP_MS / 1000 }, 'penjadwal pengingat tugas aktif');
  tick();
}
