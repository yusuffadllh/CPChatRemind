package com.yusuf.wareminder.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Catatan hasil ekstraksi yang sudah disetujui.
 */
@Entity(tableName = "notes")
data class NoteEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val body: String,
    val sender: String,
    val createdAt: Long,
    /** Id event di kalender bawaan, null kalau ini catatan biasa. */
    val calendarEventId: Long? = null,
    val eventStart: Long? = null
)

enum class PendingType { EVENT, NOTE }

enum class PendingStatus { WAITING, APPROVED, REJECTED, FAILED }

/**
 * Hasil ekstraksi yang menunggu konfirmasi user.
 */
@Entity(tableName = "pending")
data class PendingEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val type: PendingType,
    val title: String,
    val body: String,
    val sender: String,
    val rawMessage: String,
    val startMillis: Long? = null,
    val endMillis: Long? = null,
    val allDay: Boolean = false,
    val location: String? = null,
    val confidence: Float = 0f,
    val status: PendingStatus = PendingStatus.WAITING,
    val createdAt: Long = System.currentTimeMillis(),
    val error: String? = null
)
