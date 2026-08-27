package com.yusuf.wareminder.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

data class Settings(
    val geminiApiKey: String = "",
    val model: String = "gemini-2.0-flash",
    /** Nomor / nama kontak yang diizinkan. Kosong = tidak ada pesan yang diproses. */
    val whitelist: List<String> = emptyList(),
    val requireKeyword: Boolean = false,
    val keywords: List<String> = listOf("/catat", "/ingatkan"),
    val calendarId: Long = -1L,
    val calendarName: String = "",
    val reminderMinutesBefore: Int = 30,
    val timezone: String = "Asia/Jakarta",
    /** Kalau true, event/catatan langsung disimpan tanpa menunggu tombol Setujui. */
    val autoApprove: Boolean = false,
    /** Balas ✅/❌ ke chat WhatsApp lewat action Reply di notifikasi. */
    val autoReply: Boolean = true,
    val enabled: Boolean = true
) {
    val isConfigured: Boolean
        get() = geminiApiKey.isNotBlank() && whitelist.isNotEmpty() && calendarId > 0
}

class SettingsStore(private val context: Context) {

    private object Keys {
        val API_KEY = stringPreferencesKey("gemini_api_key")
        val MODEL = stringPreferencesKey("model")
        val WHITELIST = stringPreferencesKey("whitelist")
        val REQUIRE_KEYWORD = booleanPreferencesKey("require_keyword")
        val KEYWORDS = stringPreferencesKey("keywords")
        val CALENDAR_ID = longPreferencesKey("calendar_id")
        val CALENDAR_NAME = stringPreferencesKey("calendar_name")
        val REMINDER_MINUTES = intPreferencesKey("reminder_minutes")
        val TIMEZONE = stringPreferencesKey("timezone")
        val AUTO_APPROVE = booleanPreferencesKey("auto_approve")
        val AUTO_REPLY = booleanPreferencesKey("auto_reply")
        val ENABLED = booleanPreferencesKey("enabled")
    }

    val settings: Flow<Settings> = context.dataStore.data.map { p ->
        val default = Settings()
        Settings(
            geminiApiKey = p[Keys.API_KEY] ?: default.geminiApiKey,
            model = p[Keys.MODEL] ?: default.model,
            whitelist = p[Keys.WHITELIST].toList(),
            requireKeyword = p[Keys.REQUIRE_KEYWORD] ?: default.requireKeyword,
            keywords = p[Keys.KEYWORDS]?.toList()?.takeIf { it.isNotEmpty() } ?: default.keywords,
            calendarId = p[Keys.CALENDAR_ID] ?: default.calendarId,
            calendarName = p[Keys.CALENDAR_NAME] ?: default.calendarName,
            reminderMinutesBefore = p[Keys.REMINDER_MINUTES] ?: default.reminderMinutesBefore,
            timezone = p[Keys.TIMEZONE] ?: default.timezone,
            autoApprove = p[Keys.AUTO_APPROVE] ?: default.autoApprove,
            autoReply = p[Keys.AUTO_REPLY] ?: default.autoReply,
            enabled = p[Keys.ENABLED] ?: default.enabled
        )
    }

    suspend fun current(): Settings = settings.first()

    suspend fun setApiKey(value: String) = put(Keys.API_KEY, value.trim())

    suspend fun setModel(value: String) = put(Keys.MODEL, value.trim())

    suspend fun setWhitelist(values: List<String>) =
        put(Keys.WHITELIST, values.map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n"))

    suspend fun setRequireKeyword(value: Boolean) = put(Keys.REQUIRE_KEYWORD, value)

    suspend fun setKeywords(values: List<String>) =
        put(Keys.KEYWORDS, values.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.joinToString("\n"))

    suspend fun setCalendar(id: Long, name: String) {
        context.dataStore.edit {
            it[Keys.CALENDAR_ID] = id
            it[Keys.CALENDAR_NAME] = name
        }
    }

    suspend fun setReminderMinutes(value: Int) = put(Keys.REMINDER_MINUTES, value.coerceIn(0, 24 * 60))

    suspend fun setTimezone(value: String) = put(Keys.TIMEZONE, value.trim())

    suspend fun setAutoApprove(value: Boolean) = put(Keys.AUTO_APPROVE, value)

    suspend fun setAutoReply(value: Boolean) = put(Keys.AUTO_REPLY, value)

    suspend fun setEnabled(value: Boolean) = put(Keys.ENABLED, value)

    private suspend fun <T> put(key: Preferences.Key<T>, value: T) {
        context.dataStore.edit { it[key] = value }
    }

    private fun String?.toList(): List<String> =
        this?.split('\n')?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()
}
