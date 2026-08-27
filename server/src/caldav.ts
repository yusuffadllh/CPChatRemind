import { randomUUID } from 'node:crypto';
import ical, { ICalAlarmType, ICalCalendarMethod } from 'ical-generator';
import type { DateTime } from 'luxon';
import { createDAVClient, type DAVCalendar } from 'tsdav';
import { config } from './config.js';
import { logger } from './logger.js';

/** createDAVClient mengembalikan kumpulan method, bukan instance kelas DAVClient. */
type DavClient = Awaited<ReturnType<typeof createDAVClient>>;

let clientPromise: Promise<DavClient> | null = null;
let calendarCache: DAVCalendar | null = null;

async function getClient(): Promise<DavClient> {
  clientPromise ??= createDAVClient({
    serverUrl: config.CALDAV_URL,
    credentials: {
      username: config.CALDAV_USERNAME,
      password: config.CALDAV_PASSWORD,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  return await clientPromise;
}

/** Nama kalender bisa berupa string atau objek multi-bahasa, tergantung server. */
function calendarName(calendar: DAVCalendar): string {
  const raw = calendar.displayName;
  if (typeof raw === 'string') return raw;
  return calendar.url;
}

async function getCalendar(): Promise<DAVCalendar> {
  if (calendarCache) return calendarCache;

  const client = await getClient();
  const calendars = await client.fetchCalendars();
  const writable = calendars.filter(
    (calendar) => calendar.components?.includes('VEVENT') ?? true,
  );

  if (writable.length === 0) {
    throw new Error('Tidak ada kalender CalDAV yang bisa menyimpan event');
  }

  const wanted = config.CALDAV_CALENDAR.trim().toLowerCase();
  const picked = wanted
    ? writable.find((calendar) => calendarName(calendar).toLowerCase() === wanted)
    : writable[0];

  if (!picked) {
    const available = writable.map(calendarName).join(', ');
    throw new Error(
      `Kalender "${config.CALDAV_CALENDAR}" tidak ditemukan. Yang tersedia: ${available}`,
    );
  }

  logger.info({ calendar: calendarName(picked) }, 'Kalender CalDAV siap');
  calendarCache = picked;
  return picked;
}

export interface EventInput {
  title: string;
  description?: string | undefined;
  location?: string | undefined;
  start: DateTime;
  end?: DateTime | null | undefined;
  allDay: boolean;
}

/** @returns UID event yang dibuat. */
export async function createEvent(input: EventInput): Promise<string> {
  const uid = randomUUID();
  const end = input.end ?? input.start.plus(input.allDay ? { days: 1 } : { hours: 1 });

  const calendar = ical({ prodId: '//wa-reminder//id', method: ICalCalendarMethod.PUBLISH });
  const event = calendar.createEvent({
    id: uid,
    start: input.start.toJSDate(),
    end: end.toJSDate(),
    allDay: input.allDay,
    timezone: config.TIMEZONE,
    summary: input.title,
    description: input.description,
    location: input.location,
  });

  if (config.REMINDER_MINUTES_BEFORE > 0) {
    event.createAlarm({
      type: ICalAlarmType.display,
      triggerBefore: config.REMINDER_MINUTES_BEFORE * 60,
    });
  }

  const client = await getClient();
  const target = await getCalendar();
  const response = await client.createCalendarObject({
    calendar: target,
    filename: `${uid}.ics`,
    iCalString: calendar.toString(),
  });

  if (!response.ok) {
    throw new Error(`CalDAV menolak event: HTTP ${response.status}`);
  }

  return uid;
}

/** Dipanggil saat startup supaya kesalahan kredensial/URL ketahuan lebih awal. */
export async function verifyConnection(): Promise<void> {
  await getCalendar();
}
