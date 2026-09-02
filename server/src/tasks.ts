import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { config } from './config.js';
import { nowIso } from './time.js';

/** Satu lapis pengingat. `fireAt` sudah absolut supaya penjadwal tidak menghitung ulang. */
export interface ReminderLayer {
  /** Menit sebelum tenggat; disimpan untuk ditampilkan ke pengguna. */
  minutesBefore: number;
  fireAt: string;
  status: 'pending' | 'sent' | 'skipped';
  sentAt?: string;
}

export interface Task {
  id: string;
  /** Catatan asalnya di notes.jsonl, biar bisa ditelusuri. */
  noteId: string;
  /** Tujuan pengiriman pengingat. Note tidak menyimpan jid, jadi disimpan di sini. */
  jid: string;
  title: string;
  body: string;
  /** ISO bertimezone. Wajib ada: tugas tanpa tenggat tidak masuk ke sini. */
  deadline: string;
  difficulty: number;
  workMinutes: number;
  /** Alasan taksiran dari Gemini, ditampilkan supaya salah taksir kelihatan. */
  reason: string;
  createdAt: string;
  layers: ReminderLayer[];
  status: 'active' | 'done';
}

const filePath = join(config.DATA_DIR, 'tasks.jsonl');

/**
 * Beda dari notes.jsonl yang append-only: status lapisan pengingat berubah
 * setelah terkirim, jadi berkasnya ditulis ulang seluruhnya. Lewat file
 * sementara + rename supaya tidak ada kondisi setengah tertulis.
 */
async function writeAll(tasks: Task[]): Promise<void> {
  await mkdir(config.DATA_DIR, { recursive: true });
  const body = tasks.map((task) => JSON.stringify(task)).join('\n');
  const temp = `${filePath}.tmp`;
  await writeFile(temp, body.length > 0 ? `${body}\n` : '', 'utf8');
  await rename(temp, filePath);
}

export async function readTasks(): Promise<Task[]> {
  try {
    const content = await readFile(filePath, 'utf8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Task);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Semua tulisan lewat satu rantai promise. Penjadwal dan handler bisa jalan
 * bersamaan, dan read-modify-write tanpa penjagaan bisa menghilangkan data.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  // Rantai tidak boleh mati gara-gara satu kegagalan.
  queue = next.catch(() => undefined);
  return next;
}

export function saveTask(task: Task): Promise<void> {
  return serialize(async () => {
    const tasks = await readTasks();
    tasks.push(task);
    await writeAll(tasks);
  });
}

/** Ubah satu tugas di tempat; `mutate` dipanggil setelah data terbaru dibaca. */
export function updateTask(id: string, mutate: (task: Task) => void): Promise<boolean> {
  return serialize(async () => {
    const tasks = await readTasks();
    const target = tasks.find((task) => task.id === id);
    if (!target) return false;
    mutate(target);
    await writeAll(tasks);
    return true;
  });
}

// --- Perencanaan lapisan pengingat -------------------------------------------

/**
 * Seberapa jauh sebelum tenggat pengingat pertama dikirim, sebagai kelipatan
 * lama kerja. Makin sulit, makin butuh jarak: tugas berat tidak bisa dikebut
 * semalam, jadi harus diberi tahu jauh-jauh hari.
 */
const START_MULTIPLIER: Record<number, number> = { 1: 2, 2: 2.5, 3: 3, 4: 4, 5: 5 };

/**
 * Batas pengingat paling awal: 30 hari. Beda dari MAX_REMINDER_MINUTES yang
 * mengatur alarm kalender — pengingat tugas dikirim bot sendiri, jadi tidak
 * terikat aturan VALARM.
 */
const MAX_LEAD_MINUTES = 30 * 24 * 60;

/**
 * Jeda minimum antar lapisan, ikut ukuran tugasnya. Tugas 20 menit tidak perlu
 * jarak 45 menit antar pengingat, tapi tugas berhari-hari perlu.
 */
function minGap(workMinutes: number): number {
  return Math.max(15, Math.min(Math.round(workMinutes / 2), 120));
}

/** Aba-aba terakhir sebelum tenggat, dibatasi biar tidak terlalu mepet/jauh. */
function finalLead(workMinutes: number): number {
  return Math.min(Math.max(Math.round(workMinutes / 2), 30), 240);
}

/**
 * Hitung lapisan lead time (menit sebelum tenggat), urut dari paling awal.
 * Hasilnya belum memperhitungkan waktu sekarang.
 */
export function planLeads(difficulty: number, workMinutes: number): number[] {
  const level = Math.min(Math.max(Math.round(difficulty), 1), 5);
  const work = Math.max(Math.round(workMinutes), 5);
  const multiplier = START_MULTIPLIER[level] ?? 3;

  const start = Math.min(Math.round(work * multiplier), MAX_LEAD_MINUTES);
  const last = finalLead(work);
  // Peluruhan separuh: jaraknya rapat saat tenggat makin dekat.
  const candidates = [start, Math.round(start / 2), Math.round(start / 4), last];
  const gap = minGap(work);

  const leads: number[] = [];
  for (const lead of [...new Set(candidates)].sort((a, b) => b - a)) {
    if (lead < 10) continue;
    const previous = leads.at(-1);
    // Kandidat urut menurun, jadi selisihnya selalu positif.
    if (previous !== undefined && previous - lead < gap) continue;
    leads.push(lead);
  }

  return leads.length > 0 ? leads : [last];
}

/**
 * Ubah lead time jadi lapisan siap simpan.
 *
 * Lapisan yang waktunya sudah lewat tidak dibuang — pengguna minta pengingat
 * tetap dikirim asal tenggatnya belum lewat. Tapi kalau ada beberapa yang
 * telat sekaligus, hanya yang paling belakang yang dipakai supaya tidak
 * mengirim tiga pesan sekaligus.
 */
export function buildLayers(deadline: DateTime, leads: number[]): ReminderLayer[] {
  const now = DateTime.now().setZone(config.TIMEZONE);

  const all = leads.map((minutesBefore) => ({
    minutesBefore,
    at: deadline.minus({ minutes: minutesBefore }),
  }));

  const future = all.filter((layer) => layer.at > now);
  const overdue = all.filter((layer) => layer.at <= now);

  // Yang telat: ambil satu saja, yang paling dekat ke tenggat (lead terkecil),
  // supaya tidak mengirim beberapa pesan sekaligus saat tugas dicatat mepet.
  const collapsed = overdue.at(-1);
  const picked = collapsed ? [collapsed, ...future] : future;

  // all selalu berisi minimal satu lead, jadi ini cuma jaring pengaman.
  const layers = picked.length > 0 ? picked : all.slice(-1);

  return layers.map((layer) => ({
    minutesBefore: layer.minutesBefore,
    fireAt: layer.at.toISO() ?? '',
    status: 'pending' as const,
  }));
}

/** Rakit satu tugas lengkap dengan jadwal pengingatnya. */
export function buildTask(input: {
  noteId: string;
  jid: string;
  title: string;
  body: string;
  deadline: DateTime;
  difficulty: number;
  workMinutes: number;
  reason: string;
}): Task {
  const leads = planLeads(input.difficulty, input.workMinutes);

  return {
    id: randomUUID(),
    noteId: input.noteId,
    jid: input.jid,
    title: input.title,
    body: input.body,
    deadline: input.deadline.toISO() ?? '',
    difficulty: input.difficulty,
    workMinutes: input.workMinutes,
    reason: input.reason,
    createdAt: nowIso(),
    layers: buildLayers(input.deadline, leads),
    status: 'active',
  };
}
