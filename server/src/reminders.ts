import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { config } from './config.js';
import { nowIso } from './time.js';

/**
 * Pengingat WA murni: bot mengirim pesan berulang sampai tanggal berhentinya.
 * Beda dari tugas (berbasis tenggat + taksiran kesulitan) dan beda dari event
 * kalender (VALARM) — yang ini tidak menyentuh CalDAV sama sekali.
 */
export interface Reminder {
  id: string;
  /** Tujuan pengiriman, sama seperti jid di Task. */
  jid: string;
  title: string;
  /** Detail tambahan yang ikut dikirim tiap pengingat; boleh kosong. */
  body: string;
  /**
   * Pola pengiriman:
   * - "interval": setiap `intervalMinutes` menit.
   * - "daily": setiap hari jam `dailyAt` (HH:mm, zona TIMEZONE).
   */
  pattern: { kind: 'interval'; intervalMinutes: number } | { kind: 'daily'; dailyAt: string };
  /** ISO bertimezone. Pengiriman berhenti setelah lewat waktu ini. */
  stopAt: string;
  createdAt: string;
  /** ISO waktu kirim terakhir; kosong kalau belum pernah. */
  lastSentAt?: string;
  status: 'active' | 'done';
}

const filePath = join(config.DATA_DIR, 'reminders.jsonl');

/**
 * Sama seperti tasks.jsonl: `lastSentAt` berubah setelah terkirim, jadi
 * ditulis ulang seluruhnya lewat berkas sementara + rename.
 */
async function writeAll(reminders: Reminder[]): Promise<void> {
  await mkdir(config.DATA_DIR, { recursive: true });
  const body = reminders.map((reminder) => JSON.stringify(reminder)).join('\n');
  const temp = `${filePath}.tmp`;
  await writeFile(temp, body.length > 0 ? `${body}\n` : '', 'utf8');
  await rename(temp, filePath);
}

export async function readReminders(): Promise<Reminder[]> {
  try {
    const content = await readFile(filePath, 'utf8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Reminder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Semua tulisan lewat satu rantai promise; scheduler dan handler bisa jalan
 * bersamaan dan read-modify-write tanpa penjagaan bisa menghilangkan data.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export function saveReminder(reminder: Reminder): Promise<void> {
  return serialize(async () => {
    const reminders = await readReminders();
    reminders.push(reminder);
    await writeAll(reminders);
  });
}

/** Ubah satu pengingat di tempat; `mutate` dipanggil dengan data terbaru. */
export function updateReminder(id: string, mutate: (reminder: Reminder) => void): Promise<boolean> {
  return serialize(async () => {
    const reminders = await readReminders();
    const target = reminders.find((reminder) => reminder.id === id);
    if (!target) return false;
    mutate(target);
    await writeAll(reminders);
    return true;
  });
}

export function listActiveReminders(): Promise<Reminder[]> {
  return readReminders().then((reminders) =>
    reminders.filter((reminder) => reminder.status === 'active'),
  );
}

/** Batas sisi supaya "/inget ... selamanya" tidak jadi mesin spam. */
const MAX_INTERVAL_MINUTES = 30 * 24 * 60;
export const MAX_STOP_DAYS = 365;

/**
 * Rapikan pola hasil Gemini: interval dijepit ke rentang wajar, stopAt yang
 * tidak valid dibuang. Null kalau polanya tidak bisa dipakai.
 */
export function normalizePattern(
  intervalMinutes: number | null | undefined,
  stopAt: DateTime | null | undefined,
): { pattern: Reminder['pattern']; stopAt: DateTime } | null {
  if (!intervalMinutes || intervalMinutes <= 0) return null;
  const interval = Math.min(Math.max(Math.round(intervalMinutes), 1), MAX_INTERVAL_MINUTES);
  const fallback = DateTime.now().setZone(config.TIMEZONE).plus({ days: 7 });
  const stop = stopAt && stopAt.isValid ? stopAt : fallback;
  return { pattern: { kind: 'interval', intervalMinutes: interval }, stopAt: stop };
}

export function buildReminder(input: {
  jid: string;
  title: string;
  body: string;
  pattern: Reminder['pattern'];
  stopAt: DateTime;
}): Reminder {
  return {
    id: randomUUID(),
    jid: input.jid,
    title: input.title,
    body: input.body,
    pattern: input.pattern,
    stopAt: input.stopAt.toISO() ?? '',
    createdAt: nowIso(),
    status: 'active',
  };
}

/** Jadwal kirim berikutnya untuk pola interval; null kalau sudah lewat stopAt. */
export function nextIntervalFire(reminder: Reminder, now: DateTime): DateTime | null {
  if (reminder.pattern.kind !== 'interval') return null;
  const stop = DateTime.fromISO(reminder.stopAt, { zone: config.TIMEZONE });
  if (!stop.isValid || now > stop) return null;

  const last = reminder.lastSentAt ? DateTime.fromISO(reminder.lastSentAt, { zone: config.TIMEZONE }) : null;
  const created = DateTime.fromISO(reminder.createdAt, { zone: config.TIMEZONE });
  // Belum pernah terkirim: kirim pada sapuan pertama setelah dibuat. Kalau
  // sudah, lanjut dari waktu terakhir + interval (bukan dari sekarang) supaya
  // driftnya tetap stabil walau server sempat mati.
  const base =
    last && last.isValid
      ? last
      : created.isValid
        ? created
        : now;
  const next = base.plus({ minutes: reminder.pattern.intervalMinutes });
  return next > stop ? null : next;
}

/** Jadwal kirim berikutnya untuk pola harian; null kalau sudah lewat stopAt. */
export function nextDailyFire(reminder: Reminder, now: DateTime): DateTime | null {
  if (reminder.pattern.kind !== 'daily') return null;
  const stop = DateTime.fromISO(reminder.stopAt, { zone: config.TIMEZONE });
  if (!stop.isValid || now > stop) return null;

  const [hours, minutes] = reminder.pattern.dailyAt.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  let candidate = now.startOf('day').set({
    hour: hours,
    minute: minutes,
    second: 0,
    millisecond: 0,
  });
  if (candidate <= now) candidate = candidate.plus({ days: 1 });
  return candidate > stop ? null : candidate;
}

/** Jadwal kirim berikutnya untuk pola apa pun; null berarti tidak ada lagi. */
export function nextFire(reminder: Reminder, now: DateTime): DateTime | null {
  return reminder.pattern.kind === 'interval'
    ? nextIntervalFire(reminder, now)
    : nextDailyFire(reminder, now);
}
