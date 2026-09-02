import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import type { Attachment } from './media.js';

export interface Note {
  id: string;
  title: string;
  body: string;
  sender: string;
  createdAt: string;
  eventUid?: string;
  eventStart?: string;
  /** Menit alarm sebelum event; hanya ada di catatan yang punya eventStart. */
  reminderMinutes?: number;
  /** Berkas yang ikut dikirim, tersimpan di DATA_DIR. */
  attachment?: Attachment;
}

const filePath = join(config.DATA_DIR, 'notes.jsonl');

export async function saveNote(note: Note): Promise<void> {
  await mkdir(config.DATA_DIR, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(note)}\n`, 'utf8');
}

export async function readNotes(): Promise<Note[]> {
  try {
    const content = await readFile(filePath, 'utf8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Note);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
