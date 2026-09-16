import { DateTime } from 'luxon';
import { config, MEDIA_KEYWORD, REMINDER_KEYWORD, TASK_KEYWORD } from './config.js';
import { describeAlarm } from './duration.js';
import { formatBytes } from './media.js';
import { readNotes, type Note } from './notes.js';
import { readTasks, type Task } from './tasks.js';
import { formatMoment } from './time.js';

/** Batas baris supaya balasan WhatsApp tidak jadi tembok teks. */
const DEFAULT_LIMIT = 3;
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

/** Beda maksimal satu huruf (sisip/hapus/tukar), cukup untuk salah ketik biasa. */
function nearlySame(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;

  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i] && (diff += 1) > 1) return false;
    }
    return true;
  }

  // Satu huruf hilang: samakan sisanya setelah melewati posisi yang beda.
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  let i = 0;
  let skipped = false;
  for (let j = 0; j < short.length; i += 1, j += 1) {
    if (long[i] === short[j]) continue;
    if (skipped) return false;
    skipped = true;
    j -= 1;
  }
  return true;
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
  const guess =
    known.find((item) => item.startsWith(head) || head.startsWith(item)) ??
    known.find((item) => nearlySame(item, head));

  return [
    `🤷 Perintah \`${head}\` tidak dikenal.`,
    guess ? `Maksudnya \`${guess}\`?` : 'Kirim `/bantuan` untuk lihat semua perintah.',
  ].join(' ');
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

  if (note.attachment) {
    rows.push(`   📎 ${formatBytes(note.attachment.bytes)} · \`${note.attachment.path}\``);
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

function renderActiveTasks(tasks: Task[]): string {
  if (tasks.length === 0) return '🎯 Tidak ada tugas yang belum selesai.';

  return [
    `🎯 *${tasks.length} tugas belum selesai*`,
    ...tasks.map((task, index) => {
      const next = task.layers
        .filter((layer) => layer.status === 'pending')
        .sort((a, b) => a.fireAt.localeCompare(b.fireAt))[0];
      return [
        `${index + 1}. *${task.title}*`,
        `   ⏰ Tenggat ${formatMoment(task.deadline)}`,
        next ? `   🔔 Berikutnya ${formatMoment(next.fireAt)}` : '   🔔 Tidak ada pengingat tersisa',
      ].join('\n');
    }),
  ].join('\n');
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

  return [
    '🤖 *wa-reminder*',
    '',
    config.REQUIRE_KEYWORD
      ? `Awali pesan dengan ${write}.`
      : 'Kata kunci dimatikan: semua pesan langsung diproses.',
    '',
    `📝 \`${primary} wifi rumah 12345\` — catat`,
    `📅 \`/ingatkan besok jam 3 meeting\` — ke Kalender HP`,
    '   Atur alarm: `ingetin 2 jam sebelumnya`, `pas jamnya`.',
    `🎯 \`${TASK_KEYWORD} laporan, deadline 20 Okt\` — bot nge-WA sebelum tenggat`,
    '   Atur sendiri: `deadline 20 Okt, ingetin tiap jam`.',
    `⏰ \`${REMINDER_KEYWORD} minum air tiap 2 jam\` — bot nge-WA rutin, tanpa kalender`,
    `   Pola lain: \`tiap hari jam 6 pagi\`, \`tiap 30 menit\`. Berhenti: \`${REMINDER_KEYWORD} batal <nama>\``,
    `💾 \`${MEDIA_KEYWORD} struk\` + foto/video — simpan berkasnya`,
    '',
    '📖 `/list` (3 catatan terakhir + tugas belum selesai) · `/cari wifi` · `/agenda` · `/bantuan`',
  ].join('\n');
}

/** Balasan singkat kalau kata kunci dikirim tanpa isi, mis. hanya "/catat". */
export function emptyPayloadHint(keyword: string): string {
  if (keyword === REMINDER_KEYWORD) {
    return [
      `⏰ \`${keyword}\` masih kosong. Contoh:`,
      `\`${keyword} minum air tiap 2 jam\``,
      `\`${keyword} tiap hari jam 6 pagi minum obat\``,
    ].join('\n');
  }

  if (keyword === TASK_KEYWORD) {
    return [
      `🎯 \`${keyword}\` masih kosong. Contoh:`,
      `\`${keyword} laporan praktikum, dikumpul Jumat jam 5 sore\``,
      `\`${keyword} tugas, deadline 20 Okt, ingetin tiap jam\``,
    ].join('\n');
  }

  return [
    `✏️ \`${keyword}\` masih kosong. Contoh:`,
    `\`${keyword} beli beras 5kg\``,
    '`/ingatkan besok jam 3 sore rapat, ingetin 1 jam sebelumnya`',
    '',
    keyword === MEDIA_KEYWORD
      ? 'Lampirkan foto/video dengan keterangan itu untuk menyimpan berkasnya.'
      : `Mau simpan foto/video? Pakai \`${MEDIA_KEYWORD}\`.`,
  ].join('\n');
}

export async function runCommand(command: Command): Promise<string> {
  if (command.name === 'bantuan') return helpText();

  const notes = await readNotes();

  if (command.name === 'list') {
    const tasks = (await readTasks()).filter((task) => task.status === 'active');
    const limit = command.argument ? limitFrom(command.argument) : DEFAULT_LIMIT;
    const picked = newestFirst(notes).slice(0, limit);
    const notesText = renderList(
      `📋 *${picked.length} catatan terakhir* (total ${notes.length})`,
      picked,
      '📭 Belum ada catatan.',
    );
    return `${renderActiveTasks(tasks)}\n\n${notesText}`;
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
