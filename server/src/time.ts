import { DateTime } from 'luxon';
import { config } from './config.js';

/**
 * Format waktu untuk balasan WhatsApp, mis. "Sen, 20 Okt 2026 • 23:59".
 * Dipisah ke modul sendiri supaya commands.ts dan tasks.ts memakai format yang
 * sama tanpa saling impor.
 */
export function formatMoment(iso: string): string {
  const parsed = DateTime.fromISO(iso, { zone: config.TIMEZONE });
  if (!parsed.isValid) return '-';
  return parsed.setLocale('id').toFormat('ccc, dd LLL yyyy • HH:mm');
}

/** Waktu sekarang di zona waktu bot. */
export function now(): DateTime {
  return DateTime.now().setZone(config.TIMEZONE);
}

/** Waktu sekarang sebagai ISO bertimezone, siap ditulis ke JSONL. */
export function nowIso(): string {
  return now().toISO() ?? '';
}
