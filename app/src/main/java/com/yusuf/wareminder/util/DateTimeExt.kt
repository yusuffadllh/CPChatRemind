package com.yusuf.wareminder.util

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val displayFormat = DateTimeFormatter
    .ofPattern("EEE, dd MMM yyyy • HH:mm", Locale("id", "ID"))

/**
 * Parse ISO-8601 dari Gemini. Menerima "2026-08-26T15:00:00",
 * "2026-08-26T15:00", "2026-08-26", atau bentuk dengan offset/Z.
 */
fun String.parseLocalDateTime(timezone: String): Long? {
    val zone = runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() }
    val value = trim()
    if (value.isEmpty() || value.equals("null", ignoreCase = true)) return null

    runCatching { return Instant.parse(value).toEpochMilli() }
    runCatching {
        return LocalDateTime.parse(value).atZone(zone).toInstant().toEpochMilli()
    }
    runCatching {
        return LocalDate.parse(value).atStartOfDay(zone).toInstant().toEpochMilli()
    }
    return null
}

fun Long.formatDateTime(timezone: String): String {
    val zone = runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() }
    return Instant.ofEpochMilli(this).atZone(zone).format(displayFormat)
}
