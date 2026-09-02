import { DateTime } from 'luxon';
import { config } from './config.js';
import { describeAlarm, formatLead } from './duration.js';
import { readNotes, type Note } from './notes.js';

/** Batas baris supaya balasan WhatsApp tidak jadi tembok teks. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;
const BODY_PREVIEW = 120;

type CommandName = 'list' | 'cari' | 'agenda' | 'bantuan';

/** Beberapa alias supaya tidak perlu hafal satu ejaan saja. */
const ALIASES: Record<string, CommandName> = {
  '/list': 'list',
  '/daftar': 'list',
  '/catatan': 'list',
  '/cari': 'cari',
  '/search': 'cari',
  '/agenda': 'agenda',
  '/jadwal': 'agenda',
  '/bantuan': 'bantuan',
  '/help': 'bantuan',
  '/menu': 'bantuan',
  '/start': 'bantuan',
  '/mulai': 'bantuan',
  '/?': 'bantuan',
};

/** Perintah yang ditawarkan saat pengguna salah tulis. Alias tidak perlu ikut. */
const SUGGESTED = ['/list', '/cari', '/agenda', '/bantuan'] as const;

export interface Command {
  name: CommandName;
  argument: string;
}

/** null berarti teks ini bukan perintah baca, lanjut ke jalur Gemini. */
export function parseCommand(text: string): Command | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const [head, ...rest] = trimmed.split(/\s+/);
  const name = ALIASES[(head ?? '').toLowerCase()];
  if (!name) return null;

  return { name, argument: rest.join(' ').trim() };
}

/**
 * Teks diawali "/" tapi bukan perintah apa pun dan bukan kata kunci simpan.
 * Tanpa ini pesan salah tulis hilang tanpa jawaban sama sekali.
 */
export function unknownCommandHint(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const head = (trimmed.split(/\s+/)[0] ?? '').toLowerCase();
  if (ALIASES[head] || config.KEYWORDS.includes(head)) return null;

  const known = [...new Set([...config.KEYWORDS, ...SUGGESTED])];
  const guess = known.find((item) => item.startsWith(head) || head.startsWith(item));

  return [
    `🤷 Perintah \`${head}\` tidak dikenal.`,
    guess ? `Maksudnya \`${guess}\`?` : 'Kirim `/bantuan` untuk lihat semua perintah.',
  ].join(' ');
}

function formatMoment(iso: string): string {
  const parsed = DateTime.fromISO(iso, { zone: config.TIMEZONE });
  if (!parsed.isValid) return '-';
  return parsed.setLocale('id').toFormat('ccc, dd LLL yyyy • HH:mm');
}

function preview(body: string): string {
  const clean = body.replace(/\s+/gu, ' ').trim();
  return clean.length > BODY_PREVIEW ? `${clean.slice(0, BODY_PREVIEW - 1)}…` : clean;
}

function renderNote(index: number, note: Note): string {
  const rows = [`${index}. *${note.title}*`];
  rows.push(
    note.eventStart
      ? `   📅 ${formatMoment(note.eventStart)}`
      : `   🕒 ${formatMoment(note.createdAt)}`,
  );

  if (note.eventStart && note.reminderMinutes !== undefined) {
    rows.push(`   ${describeAlarm(note.reminderMinutes)}`);
  }

  const body = preview(note.body);
  if (body && body.toLowerCase() !== note.title.trim().toLowerCase()) {
    rows.push(`   ${body}`);
  }
  return rows.join('\n');
}

function renderList(heading: string, notes: Note[], empty: string): string {
  if (notes.length === 0) return empty;
  const body = notes.map((note, index) => renderNote(index + 1, note)).join('\n\n');
  return `${heading}\n\n${body}`;
}

function limitFrom(argument: string): number {
  const parsed = Number.parseInt(argument, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/** Terbaru di atas; JSONL memang urut tulis, tapi sort biar tetap aman. */
function newestFirst(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function helpText(): string {
  const write = config.KEYWORDS.map((keyword) => `\`${keyword}\``).join(' / ');
  const primary = config.KEYWORDS[0] ?? '/catat';
  const fallback =
    config.REMINDER_MINUTES_BEFORE > 0
      ? `${formatLead(config.REMINDER_MINUTES_BEFORE)} sebelum acara`
      : 'tepat saat acara mulai';

  return [
    '🤖 *wa-reminder* — catatan & pengingat lewat WhatsApp',
    '',
    config.REQUIRE_KEYWORD
      ? `Pesan simpan harus diawali ${write}. Isinya bahasa bebas, tidak ada format baku.`
      : 'Kata kunci sedang dimatikan: semua pesan yang masuk langsung diproses.',
    '',
    '*1. Simpan catatan biasa*',
    `\`${primary} wifi rumah 12345\``,
    `\`${primary} ide skripsi: deteksi warna pakai HSV\``,
    'Tanpa waktu = cuma dicatat, tidak masuk kalender.',
    '',
    '*2. Buat pengingat*',
    '`/ingatkan besok jam 3 sore meeting tim`',
    '`/ingatkan sabtu jam 9 servis motor di bengkel Andi`',
    '`/ingatkan tanggal 17 seharian libur`',
    'Ada waktunya = masuk kalender HP, lengkap dengan alarm.',
    '',
    '*3. Atur jam alarm* — sebut saja di pesannya',
    '`... ingetin 2 jam sebelumnya`',
    '`... alarm sehari sebelum`',
    '`... pas jamnya` → bunyi tepat saat acara mulai',
    `Kalau tidak disebut, dipakai ${fallback}.`,
    '',
    '*4. Lihat yang sudah tersimpan*',
    '`/list` — 10 catatan terakhir',
    '`/list 25` — sebanyak yang diminta (maks 30)',
    '`/cari wifi` — cari di judul & isi',
    '`/agenda` — jadwal yang akan datang',
    '`/bantuan` — pesan ini (juga `/help`, `/menu`, `/start`)',
    '',
    '*Arti reaksi emoji di pesanmu*',
    '⏳ sedang diproses · 📅 jadi pengingat · 📝 jadi catatan',
    '📖 perintah baca · 🤷 diabaikan · ❌ gagal (alasannya dibalas)',
    '',
    `🕒 Zona waktu: ${config.TIMEZONE}`,
    '📱 Pengingat muncul di Kalender HP lewat DAVx5.',
  ].join('\n');
}

/** Balasan singkat kalau kata kunci dikirim tanpa isi, mis. hanya "/catat". */
export function emptyPayloadHint(keyword: string): string {
  return [
    `✏️ \`${keyword}\` masih kosong. Tulis isinya setelah kata kunci:`,
    `\`${keyword} beli beras 5kg\``,
    '`/ingatkan besok jam 3 sore rapat, ingetin 1 jam sebelumnya`',
    '',
    'Kirim `/bantuan` untuk daftar lengkap.',
  ].join('\n');
}

export async function runCommand(command: Command): Promise<string> {
  if (command.name === 'bantuan') return helpText();

  const notes = await readNotes();

  if (command.name === 'list') {
    const limit = limitFrom(command.argument);
    const picked = newestFirst(notes).slice(0, limit);
    return renderList(
      `📋 *${picked.length} catatan terakhir* (total ${notes.length})`,
      picked,
      '📭 Belum ada catatan. Kirim `/catat ...` untuk mulai.',
    );
  }

  if (command.name === 'cari') {
    const keyword = command.argument.toLowerCase();
    if (!keyword) return '🔍 Mau cari apa? Contoh: `/cari wifi`';

    const hits = newestFirst(notes)
      .filter(
        (note) =>
          note.title.toLowerCase().includes(keyword) ||
          note.body.toLowerCase().includes(keyword),
      )
      .slice(0, MAX_LIMIT);

    return renderList(
      `🔍 *${hits.length} hasil untuk "${command.argument}"*`,
      hits,
      `🔍 Tidak ada catatan yang mengandung "${command.argument}".`,
    );
  }

  // agenda
  const nowMs = DateTime.now().setZone(config.TIMEZONE).toMillis();
  const upcoming = notes
    .flatMap((note) => {
      if (!note.eventStart) return [];
      const at = DateTime.fromISO(note.eventStart, { zone: config.TIMEZONE });
      if (!at.isValid || at.toMillis() < nowMs) return [];
      return [{ note, ms: at.toMillis() }];
    })
    .sort((a, b) => a.ms - b.ms)
    .slice(0, DEFAULT_LIMIT)
    .map((item) => item.note);

  return renderList(
    `🗓️ *${upcoming.length} agenda mendatang*`,
    upcoming,
    '🗓️ Tidak ada agenda mendatang. Kirim `/ingatkan besok jam 3 rapat`.',
  );
}
