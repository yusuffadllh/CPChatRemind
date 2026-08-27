package com.yusuf.wareminder.work

import android.content.Context
import com.yusuf.wareminder.calendar.CalendarWriter
import com.yusuf.wareminder.data.AppDatabase
import com.yusuf.wareminder.data.NoteEntity
import com.yusuf.wareminder.data.PendingEntity
import com.yusuf.wareminder.data.PendingStatus
import com.yusuf.wareminder.data.PendingType
import com.yusuf.wareminder.data.SettingsStore
import com.yusuf.wareminder.service.ReplyRegistry
import com.yusuf.wareminder.util.formatDateTime

/**
 * Menyimpan item pending ke kalender bawaan + Room, atau menolaknya.
 * Dipakai baik dari notifikasi aksi maupun dari UI.
 */
class PendingResolver(private val context: Context) {

    suspend fun approve(pendingId: Long): Result<Long?> {
        val db = AppDatabase.get(context)
        val pending = db.pendingDao().findById(pendingId)
            ?: return Result.failure(IllegalStateException("Item tidak ditemukan"))
        if (pending.status != PendingStatus.WAITING) return Result.success(null)

        val settings = SettingsStore(context).current()
        var eventId: Long? = null

        if (pending.type == PendingType.EVENT && pending.startMillis != null) {
            val writer = CalendarWriter(context)
            if (!writer.hasPermission()) {
                return fail(db, pending, "Izin kalender belum diberikan")
            }
            if (settings.calendarId <= 0) {
                return fail(db, pending, "Kalender tujuan belum dipilih di Settings")
            }
            eventId = writer.insertEvent(
                calendarId = settings.calendarId,
                title = pending.title,
                description = buildDescription(pending),
                startMillis = pending.startMillis,
                endMillis = pending.endMillis,
                allDay = pending.allDay,
                location = pending.location,
                timezone = settings.timezone,
                reminderMinutesBefore = settings.reminderMinutesBefore
            ) ?: return fail(db, pending, "Gagal menulis ke kalender")
        }

        db.noteDao().insert(
            NoteEntity(
                title = pending.title,
                body = pending.body,
                sender = pending.sender,
                createdAt = System.currentTimeMillis(),
                calendarEventId = eventId,
                eventStart = pending.startMillis
            )
        )
        db.pendingDao().updateStatus(pending.id, PendingStatus.APPROVED, null)

        if (settings.autoReply) {
            val when_ = pending.startMillis?.formatDateTime(settings.timezone)
            val label = if (pending.type == PendingType.EVENT) "Event" else "Catatan"
            ReplyRegistry.reply(
                context,
                pending.sender,
                buildString {
                    append("\u2705 $label tersimpan: ${pending.title}")
                    if (when_ != null) append("\n\uD83D\uDCC5 $when_")
                }
            )
        }
        return Result.success(eventId)
    }

    suspend fun reject(pendingId: Long) {
        val db = AppDatabase.get(context)
        val pending = db.pendingDao().findById(pendingId)
        db.pendingDao().updateStatus(pendingId, PendingStatus.REJECTED, null)

        if (pending != null && SettingsStore(context).current().autoReply) {
            ReplyRegistry.reply(context, pending.sender, "\u274C Dibatalkan: ${pending.title}")
        }
    }

    private suspend fun fail(
        db: AppDatabase,
        pending: PendingEntity,
        reason: String
    ): Result<Long?> {
        db.pendingDao().updateStatus(pending.id, PendingStatus.FAILED, reason)
        if (SettingsStore(context).current().autoReply) {
            ReplyRegistry.reply(context, pending.sender, "\u274C Gagal: $reason")
        }
        return Result.failure(IllegalStateException(reason))
    }

    private fun buildDescription(pending: PendingEntity): String = buildString {
        appendLine(pending.body)
        appendLine()
        append("— dari WhatsApp: ${pending.sender}")
    }
}
