import { existsSync } from 'node:fs';
import { z } from 'zod';
import { MAX_REMINDER_MINUTES } from './duration.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const schema = z.object({
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY wajib diisi'),
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),
  /** Termasuk percobaan pertama. Model gratis sering balas 503 saat ramai. */
  GEMINI_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),

  WHITELIST: z.string().default('').transform(csv),
  ALLOW_SELF_CHAT: z.stringbool().default(true),

  REQUIRE_KEYWORD: z.stringbool().default(true),
  KEYWORDS: z
    .string()
    .default('/catat,/ingatkan,/note')
    .transform((value) => csv(value).map((item) => item.toLowerCase())),

  /** Batas ukuran foto/video yang mau diunduh ke DATA_DIR/media/. */
  MEDIA_MAX_MB: z.coerce.number().int().min(1).max(100).default(25),

  /**
   * Izinkan Gemini mencari di Google saat menaksir kesulitan tugas.
   * Lebih akurat untuk teknologi yang tidak umum, tapi ditagih per pencarian.
   */
  TASK_SEARCH_GROUNDING: z.stringbool().default(true),

  TIMEZONE: z.string().default('Asia/Jakarta'),
  /** Dipakai kalau pesan tidak menyebut sendiri mau diingatkan berapa lama sebelumnya. */
  REMINDER_MINUTES_BEFORE: z.coerce.number().int().min(0).max(MAX_REMINDER_MINUTES).default(30),

  CALDAV_URL: z.string().url('CALDAV_URL harus URL lengkap, contoh http://localhost:5232/'),
  CALDAV_USERNAME: z.string().min(1),
  CALDAV_PASSWORD: z.string().min(1),
  CALDAV_CALENDAR: z.string().default(''),

  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  /** Baileys sangat berisik; dipisah supaya LOG_LEVEL=debug tetap terbaca. */
  BAILEYS_LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('warn'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  console.error(`Konfigurasi .env belum lengkap:\n${issues}\n\nSalin .env.example jadi .env lalu isi.`);
  process.exit(1);
}

/**
 * Kata kunci yang selain mencatat juga menyimpan foto/video ke server.
 * Sengaja tidak lewat .env: hanya satu jalur ini yang menulis berkas ke disk,
 * jadi lebih baik namanya tetap sama di semua pemasangan.
 */
export const MEDIA_KEYWORD = '/simpan';

/**
 * Kata kunci tugas: bikin jadwal pengingat WhatsApp, bukan event kalender.
 * Sama seperti MEDIA_KEYWORD, dipatok di kode supaya alurnya tidak bisa
 * hilang gara-gara .env lama.
 */
export const TASK_KEYWORD = '/tugas';

const extraKeywords = [MEDIA_KEYWORD, TASK_KEYWORD].filter(
  (keyword) => !parsed.data.KEYWORDS.includes(keyword),
);

export const config = {
  ...parsed.data,
  // /simpan dan /tugas selalu dikenali, walau .env cuma menyebut yang lain.
  KEYWORDS: [...parsed.data.KEYWORDS, ...extraKeywords],
};

/** Hanya digit, dipakai untuk mencocokkan nomor tanpa peduli format +62 / 08. */
export const digitsOnly = (value: string): string => value.replace(/\D/g, '');

const whitelistDigits = config.WHITELIST.map(digitsOnly).filter((item) => item.length >= 8);

/** Cocokkan 9 digit terakhir supaya +6281.. dan 081.. dianggap sama. */
export const isWhitelisted = (phone: string): boolean => {
  const target = digitsOnly(phone);
  if (target.length < 8) return false;
  return whitelistDigits.some((entry) => entry.slice(-9) === target.slice(-9));
};
