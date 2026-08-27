package com.yusuf.wareminder.calendar

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import java.util.TimeZone

data class CalendarInfo(
    val id: Long,
    val displayName: String,
    val accountName: String,
    val isPrimary: Boolean
)

/**
 * Menulis event ke aplikasi Kalender BAWAAN Android lewat CalendarContract.
 * Tidak memakai Google Calendar API sama sekali.
 */
class CalendarWriter(private val context: Context) {

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) ==
            PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR) ==
            PackageManager.PERMISSION_GRANTED

    /** Kalender yang bisa ditulisi (ACCESS_LEVEL minimal CONTRIBUTOR). */
    fun listWritableCalendars(): List<CalendarInfo> {
        if (!hasPermission()) return emptyList()

        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.IS_PRIMARY
        )
        val selection = "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND " +
            "${CalendarContract.Calendars.VISIBLE} = 1 AND " +
            "${CalendarContract.Calendars.SYNC_EVENTS} = 1"
        val args = arrayOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR.toString())

        val result = mutableListOf<CalendarInfo>()
        context.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI, projection, selection, args, null
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                result += CalendarInfo(
                    id = cursor.getLong(0),
                    displayName = cursor.getString(1) ?: "(tanpa nama)",
                    accountName = cursor.getString(2) ?: "",
                    isPrimary = cursor.getInt(3) == 1
                )
            }
        }
        return result
    }

    /**
     * Insert event + reminder. Mengembalikan id event, atau null kalau gagal.
     */
    fun insertEvent(
        calendarId: Long,
        title: String,
        description: String?,
        startMillis: Long,
        endMillis: Long?,
        allDay: Boolean,
        location: String?,
        timezone: String,
        reminderMinutesBefore: Int
    ): Long? {
        if (!hasPermission()) return null

        val zone = runCatching { TimeZone.getTimeZone(timezone) }.getOrElse { TimeZone.getDefault() }
        val end = endMillis ?: (startMillis + if (allDay) DAY_MILLIS else DEFAULT_DURATION_MILLIS)

        val values = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calendarId)
            put(CalendarContract.Events.TITLE, title)
            put(CalendarContract.Events.DESCRIPTION, description)
            put(CalendarContract.Events.DTSTART, startMillis)
            put(CalendarContract.Events.DTEND, end)
            put(CalendarContract.Events.EVENT_TIMEZONE, zone.id)
            put(CalendarContract.Events.ALL_DAY, if (allDay) 1 else 0)
            put(CalendarContract.Events.HAS_ALARM, if (reminderMinutesBefore >= 0) 1 else 0)
            if (!location.isNullOrBlank()) {
                put(CalendarContract.Events.EVENT_LOCATION, location)
            }
        }

        val uri = try {
            context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)
        } catch (e: SecurityException) {
            return null
        } ?: return null

        val eventId = ContentUris.parseId(uri)
        if (reminderMinutesBefore >= 0) {
            addReminder(eventId, reminderMinutesBefore)
        }
        return eventId
    }

    private fun addReminder(eventId: Long, minutesBefore: Int) {
        val values = ContentValues().apply {
            put(CalendarContract.Reminders.EVENT_ID, eventId)
            put(CalendarContract.Reminders.MINUTES, minutesBefore)
            put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
        }
        runCatching {
            context.contentResolver.insert(CalendarContract.Reminders.CONTENT_URI, values)
        }
    }

    /** Intent untuk membuka event di aplikasi kalender bawaan. */
    fun viewEventUri(eventId: Long) =
        ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId)

    private companion object {
        const val DEFAULT_DURATION_MILLIS = 60 * 60 * 1000L
        const val DAY_MILLIS = 24 * 60 * 60 * 1000L
    }
}
