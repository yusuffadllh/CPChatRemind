import { DateTime } from 'luxon';
import { config } from './config.js';
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
};

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
  const alarm =
    config.REMINDER_MINUTES_BEFORE > 0
      ? `dialarmkan ${config.REMINDER_MINUTES_BEFORE} menit sebelumnya`
      : 'tanpa alarm awal';

  return [
    '🤖 *wa-reminder*',
    '',
    `*Simpan* — ${write}`,
    '`/catat wifi rumah 12345`',
    '`/ingatkan besok jam 3 sore meeting tim`',
    '',
    '*Lihat*',
    '`/list` — 10 catatan terakhir',
    '`/list 25` — sebanyak yang diminta (maks 30)',
    '`/cari wifi` — cari judul atau isi',
    '`/agenda` — jadwal yang akan datang',
    '`/bantuan` — pesan ini',
    '',
    `Pesan yang ada waktunya masuk kalender HP lewat DAVx5 dan ${alarm}.`,
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
