package com.yusuf.wareminder.ai

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class ExtractionType {
    @SerialName("event")
    EVENT,

    @SerialName("note")
    NOTE,

    @SerialName("ignore")
    IGNORE
}

/**
 * Bentuk JSON yang diminta dari Gemini. Semua field waktu berupa ISO-8601 lokal
 * (contoh `2026-08-26T15:00:00`) tanpa offset — offset diambil dari timezone di Settings.
 */
@Serializable
data class ExtractionResult(
    val type: ExtractionType = ExtractionType.IGNORE,
    val title: String = "",
    @SerialName("datetime_start") val datetimeStart: String? = null,
    @SerialName("datetime_end") val datetimeEnd: String? = null,
    @SerialName("all_day") val allDay: Boolean = false,
    val location: String? = null,
    val note: String? = null,
    val confidence: Float = 0f
)
