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

  WHITELIST: z.string().default('').transform(csv),
  ALLOW_SELF_CHAT: z.stringbool().default(true),

  REQUIRE_KEYWORD: z.stringbool().default(true),
  KEYWORDS: z
    .string()
    .default('/catat,/ingatkan,/note')
    .transform((value) => csv(value).map((item) => item.toLowerCase())),

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

export const config = parsed.data;

/** Hanya digit, dipakai untuk mencocokkan nomor tanpa peduli format +62 / 08. */
export const digitsOnly = (value: string): string => value.replace(/\D/g, '');

const whitelistDigits = config.WHITELIST.map(digitsOnly).filter((item) => item.length >= 8);

/** Cocokkan 9 digit terakhir supaya +6281.. dan 081.. dianggap sama. */
export const isWhitelisted = (phone: string): boolean => {
  const target = digitsOnly(phone);
  if (target.length < 8) return false;
  return whitelistDigits.some((entry) => entry.slice(-9) === target.slice(-9));
};
