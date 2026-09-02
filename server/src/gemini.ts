import { ApiError, GoogleGenAI, Type } from '@google/genai';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { config } from './config.js';

export const extractionSchema = z.object({
  type: z.enum(['event', 'note', 'ignore']),
  title: z.string().default(''),
  datetime_start: z.string().nullish(),
  datetime_end: z.string().nullish(),
  all_day: z.boolean().default(false),
  location: z.string().nullish(),
  note: z.string().nullish(),
  /** Menit sebelum acara untuk alarm; null = pakai default dari .env. */
  reminder_minutes_before: z.number().nullish(),
  confidence: z.number().min(0).max(1).default(0),
});

export type Extraction = z.infer<typeof extractionSchema>;

const SYSTEM_PROMPT = `
Kamu asisten yang membaca pesan WhatsApp berbahasa Indonesia (bisa campur bahasa
Inggris atau bahasa gaul) dan mengubahnya menjadi data terstruktur.

Tentukan salah satu:
- "event": ada acara/janji/deadline dengan waktu yang jelas atau bisa disimpulkan.
  Contoh: "besok jam 3 meeting", "Senin depan bayar listrik".
- "note": informasi yang perlu dicatat tapi TIDAK punya waktu.
  Contoh: "wifi password rumah 12345", "beli beras dan minyak".
- "ignore": obrolan biasa, sapaan, spam, OTP, atau pesan tanpa informasi berguna.

Aturan:
1. Buang prefix perintah seperti "/catat", "/ingatkan", "/note" dari judul.
2. "title" singkat, maksimal 60 karakter, tanpa tanda kutip, Bahasa Indonesia.
3. Untuk "event": "datetime_start" WAJIB terisi, format ISO-8601 waktu lokal tanpa
   offset, contoh 2026-08-28T15:00:00. Resolusikan kata relatif ("besok", "nanti
   sore", "Senin depan") berdasarkan waktu sekarang yang diberikan.
4. Kalau jam tidak disebut pakai 09:00. "pagi" 08:00, "siang" 12:00, "sore" 16:00,
   "malam" 19:00.
5. "datetime_end" opsional; kalau durasi tidak jelas biarkan null.
6. "all_day" true hanya kalau jelas acara sepanjang hari.
7. "reminder_minutes_before" = berapa MENIT sebelum acara alarm berbunyi, hanya
   kalau pengguna menyebutnya. Kalau tidak disebut, isi null.
   Contoh: "ingetin 1 jam sebelumnya" -> 60. "alarm 2 hari sebelum" -> 2880.
   "ingetin 15 menit sebelum" -> 15. "pas jamnya" / "tepat waktu" -> 0.
   "besok jam 3, ingetkan pagi harinya" -> hitung selisih menit dari waktu acara.
   Jangan mengarang angka kalau pesan tidak menyebut soal alarm.
8. "note" berisi detail lengkap. Untuk type "note" wajib terisi.
9. "confidence" 0.0-1.0 sesuai keyakinanmu.
`.trim();

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING, enum: ['event', 'note', 'ignore'] },
    title: { type: Type.STRING },
    datetime_start: { type: Type.STRING, nullable: true },
    datetime_end: { type: Type.STRING, nullable: true },
    all_day: { type: Type.BOOLEAN },
    location: { type: Type.STRING, nullable: true },
    note: { type: Type.STRING, nullable: true },
    reminder_minutes_before: { type: Type.NUMBER, nullable: true },
    confidence: { type: Type.NUMBER },
  },
  required: ['type', 'title', 'confidence'],
} as const;

const ai = new GoogleGenAI({
  apiKey: config.GEMINI_API_KEY,
  // SDK tidak retry apa-apa kalau retryOptions dikosongkan (sudah dites: 503 =
  // 1 percobaan). Model gratis sering balas 503 "high demand", jadi dinyalakan
  // dengan backoff eksponensial. Status yang di-retry default: 408, 429, 5xx.
  httpOptions: {
    retryOptions: {
      attempts: config.GEMINI_RETRY_ATTEMPTS,
      initialDelay: 1,
      maxDelay: 8,
    },
  },
});

/** Pesan ramah untuk error yang sering muncul, biar balasan WA tidak berisi JSON mentah. */
function friendlyError(error: unknown): Error {
  if (!(error instanceof ApiError)) return error instanceof Error ? error : new Error(String(error));

  if (error.status === 503) {
    return new Error('Server Gemini sedang penuh. Coba kirim ulang beberapa saat lagi.');
  }
  if (error.status === 429) {
    return new Error('Kuota Gemini habis untuk sementara. Coba lagi nanti.');
  }
  if (error.status === 400 || error.status === 403) {
    return new Error('Gemini menolak permintaan; cek GEMINI_API_KEY dan GEMINI_MODEL.');
  }
  return new Error(`Gemini error ${error.status}`);
}

export async function extract(message: string, sender: string): Promise<Extraction> {
  const now = DateTime.now().setZone(config.TIMEZONE).setLocale('id');

  const prompt = [
    `Waktu sekarang: ${now.toFormat("cccc, dd LLLL yyyy HH:mm")} (${config.TIMEZONE})`,
    `Hari ini: ${now.toISODate()}`,
    `Pengirim: ${sender}`,
    '',
    'Isi pesan WhatsApp:',
    '"""',
    message,
    '"""',
  ].join('\n');

  let response;
  try {
    response = await ai.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema,
      },
    });
  } catch (error) {
    // Retry sudah habis di sini; ubah JSON mentah SDK jadi pesan yang bisa dibaca.
    throw friendlyError(error);
  }

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini tidak mengembalikan teks');
  }

  return extractionSchema.parse(JSON.parse(text));
}

/** Parse ISO lokal dari Gemini jadi DateTime bertimezone, null kalau tak valid. */
export function parseLocal(value: string | null | undefined): DateTime | null {
  if (!value) return null;
  const parsed = DateTime.fromISO(value, { zone: config.TIMEZONE });
  return parsed.isValid ? parsed : null;
}
