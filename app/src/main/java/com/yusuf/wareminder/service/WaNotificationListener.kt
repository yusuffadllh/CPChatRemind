package com.yusuf.wareminder.service

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import com.yusuf.wareminder.data.SettingsStore
import com.yusuf.wareminder.work.ProcessMessageWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class WaNotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var settingsStore: SettingsStore

    /** Dedup: hash pesan -> waktu terakhir diproses. */
    private val recent = LinkedHashMap<String, Long>()

    override fun onCreate() {
        super.onCreate()
        settingsStore = SettingsStore(applicationContext)
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in WA_PACKAGES) return

        val extras = sbn.notification.extras
        // Notifikasi ringkasan ("5 pesan baru dari 2 chat") tidak berisi teks asli.
        if (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (extras.getBoolean(EXTRA_IS_GROUP_CONVERSATION, false)) return

        val sender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        if (sender.isEmpty()) return

        val messages = extractMessages(sbn)
        if (messages.isEmpty()) return

        ReplyHandle.from(sbn.notification)?.let { ReplyRegistry.put(sender, it) }

        scope.launch {
            val settings = settingsStore.current()
            if (!settings.enabled || settings.geminiApiKey.isBlank()) return@launch
            if (!isWhitelisted(sender, settings.whitelist)) return@launch

            for (message in messages) {
                val payload = message.trim()
                if (payload.isEmpty()) continue

                val matched = matchKeyword(payload, settings.requireKeyword, settings.keywords)
                    ?: continue
                if (!markProcessed(sender, matched)) continue

                ProcessMessageWorker.enqueue(applicationContext, sender, matched, sbn.postTime)
            }
        }
    }

    /**
     * Ambil isi pesan. WhatsApp bisa mengirim satu teks (EXTRA_TEXT) atau
     * beberapa baris saat notifikasi digabung (EXTRA_TEXT_LINES / MessagingStyle).
     */
    private fun extractMessages(sbn: StatusBarNotification): List<String> {
        val extras = sbn.notification.extras

        val styled = NotificationCompat.MessagingStyle
            .extractMessagingStyleFromNotification(sbn.notification)
            ?.messages
            ?.mapNotNull { it.text?.toString() }
            .orEmpty()
        if (styled.isNotEmpty()) return styled

        val lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.map { it.toString() }
            .orEmpty()
        if (lines.isNotEmpty()) return lines

        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
        return listOfNotNull(text?.takeIf { it.isNotBlank() && it !in IGNORED_TEXTS })
    }

    private fun isWhitelisted(sender: String, whitelist: List<String>): Boolean {
        if (whitelist.isEmpty()) return false
        val normalizedSender = normalizePhone(sender)
        return whitelist.any { entry ->
            val normalizedEntry = normalizePhone(entry)
            if (normalizedEntry.isNotEmpty() && normalizedSender.isNotEmpty()) {
                // Cocokkan 9 digit terakhir supaya +62 / 08 / tanpa kode negara sama-sama kena.
                normalizedSender.takeLast(9) == normalizedEntry.takeLast(9)
            } else {
                sender.equals(entry, ignoreCase = true)
            }
        }
    }

    /** Buang spasi, tanda hubung, dan normalkan prefix 0 / +62. */
    private fun normalizePhone(value: String): String {
        val digits = value.filter { it.isDigit() }
        if (digits.length < 8) return ""
        return digits
    }

    /**
     * Kalau kata kunci wajib, hanya pesan berawalan kata kunci yang lolos dan
     * prefix-nya dibuang. Kalau tidak wajib, pesan dikembalikan apa adanya.
     */
    private fun matchKeyword(
        message: String,
        requireKeyword: Boolean,
        keywords: List<String>
    ): String? {
        if (!requireKeyword) return message
        val lower = message.lowercase()
        val hit = keywords.firstOrNull { lower.startsWith(it.lowercase()) } ?: return null
        return message.substring(hit.length).trim().takeIf { it.isNotEmpty() }
    }

    /** @return false kalau pesan yang sama baru saja diproses. */
    @Synchronized
    private fun markProcessed(sender: String, message: String): Boolean {
        val now = System.currentTimeMillis()
        val key = "$sender|$message"
        recent.entries.removeAll { now - it.value > DEDUP_WINDOW_MILLIS }
        if (recent.containsKey(key)) return false
        if (recent.size >= MAX_RECENT) {
            recent.remove(recent.keys.first())
        }
        recent[key] = now
        return true
    }

    companion object {
        private const val EXTRA_IS_GROUP_CONVERSATION = "android.isGroupConversation"
        private const val DEDUP_WINDOW_MILLIS = 5 * 60 * 1000L
        private const val MAX_RECENT = 100

        private val WA_PACKAGES = setOf("com.whatsapp", "com.whatsapp.w4b")

        /** Teks placeholder WhatsApp yang bukan isi pesan. */
        private val IGNORED_TEXTS = setOf(
            "Mengecek pesan baru",
            "Checking for new messages",
            "Pesan baru",
            "New messages"
        )

        fun isEnabled(context: Context): Boolean {
            val flat = Settings.Secure.getString(
                context.contentResolver, "enabled_notification_listeners"
            ) ?: return false
            val expected = ComponentName(context, WaNotificationListener::class.java)
            return flat.split(':').any {
                ComponentName.unflattenFromString(it) == expected
            }
        }
    }
}
