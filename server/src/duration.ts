/** Alarm boleh 0 menit (tepat saat acara) sampai 7 hari sebelum acara. */
export const MAX_REMINDER_MINUTES = 10080;

/**
 * Bulatkan dan jepit nilai alarm dari Gemini.
 * null = tidak disebut di pesan, biar pemanggil pakai default dari .env.
 */
export function normalizeReminder(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const minutes = Math.round(value);
  if (minutes < 0) return null;
  return Math.min(minutes, MAX_REMINDER_MINUTES);
}

/** 0 -> "tepat waktu", 90 -> "1 jam 30 menit", 1500 -> "1 hari 1 jam". */
export function formatLead(minutes: number): string {
  if (minutes <= 0) return 'tepat waktu';

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} hari`);
  if (hours > 0) parts.push(`${hours} jam`);
  if (mins > 0) parts.push(`${mins} menit`);
  return parts.join(' ');
}

/** Kalimat siap pakai untuk balasan WhatsApp. */
export function describeAlarm(minutes: number): string {
  return minutes === 0
    ? '🔔 alarm tepat saat acara mulai'
    : `🔔 alarm ${formatLead(minutes)} sebelumnya`;
}
