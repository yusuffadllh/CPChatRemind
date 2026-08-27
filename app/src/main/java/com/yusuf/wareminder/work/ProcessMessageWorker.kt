package com.yusuf.wareminder.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.yusuf.wareminder.ai.ExtractionType
import com.yusuf.wareminder.ai.GeminiClient
import com.yusuf.wareminder.data.AppDatabase
import com.yusuf.wareminder.data.PendingEntity
import com.yusuf.wareminder.data.PendingType
import com.yusuf.wareminder.data.SettingsStore
import com.yusuf.wareminder.notify.ConfirmNotifier
import com.yusuf.wareminder.service.ReplyRegistry
import com.yusuf.wareminder.util.parseLocalDateTime
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Ambil pesan dari listener -> ekstrak lewat Gemini -> simpan sebagai pending
 * (atau langsung disimpan kalau autoApprove aktif).
 */
class ProcessMessageWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val sender = inputData.getString(KEY_SENDER) ?: return Result.failure()
        val message = inputData.getString(KEY_MESSAGE) ?: return Result.failure()

        val settings = SettingsStore(applicationContext).current()
        if (!settings.enabled || settings.geminiApiKey.isBlank()) return Result.success()

        val extraction = try {
            GeminiClient(settings.geminiApiKey, settings.model)
                .extract(message, sender, settings.timezone)
        } catch (e: IOException) {
            if (runAttemptCount < MAX_ATTEMPTS) return Result.retry()
            replyIfEnabled(settings.autoReply, sender, "\u274C Gagal menghubungi AI, coba kirim ulang")
            return Result.failure()
        } catch (e: Exception) {
            replyIfEnabled(settings.autoReply, sender, "\u274C Gagal memproses pesan")
            return Result.failure()
        }

        if (extraction.type == ExtractionType.IGNORE) {
            replyIfEnabled(
                settings.autoReply,
                sender,
                "\u2753 Tidak ada yang bisa dicatat dari pesan itu"
            )
            return Result.success()
        }

        val start = extraction.datetimeStart?.parseLocalDateTime(settings.timezone)
        val end = extraction.datetimeEnd?.parseLocalDateTime(settings.timezone)

        // Event tanpa waktu tidak bisa masuk kalender, turunkan jadi catatan.
        val type = if (extraction.type == ExtractionType.EVENT && start != null) {
            PendingType.EVENT
        } else {
            PendingType.NOTE
        }

        val pending = PendingEntity(
            type = type,
            title = extraction.title.ifBlank { message.take(60) },
            body = extraction.note ?: message,
            sender = sender,
            rawMessage = message,
            startMillis = start.takeIf { type == PendingType.EVENT },
            endMillis = end.takeIf { type == PendingType.EVENT },
            allDay = extraction.allDay,
            location = extraction.location,
            confidence = extraction.confidence
        )

        val db = AppDatabase.get(applicationContext)
        val id = db.pendingDao().insert(pending)

        if (settings.autoApprove) {
            PendingResolver(applicationContext).approve(id)
        } else {
            ConfirmNotifier(applicationContext)
                .showConfirmation(pending.copy(id = id), settings.timezone)
        }
        return Result.success()
    }

    private fun replyIfEnabled(enabled: Boolean, sender: String, text: String) {
        if (enabled) ReplyRegistry.reply(applicationContext, sender, text)
    }

    companion object {
        private const val KEY_SENDER = "sender"
        private const val KEY_MESSAGE = "message"
        private const val MAX_ATTEMPTS = 3

        fun enqueue(context: Context, sender: String, message: String, postTime: Long) {
            val request = OneTimeWorkRequestBuilder<ProcessMessageWorker>()
                .setInputData(
                    Data.Builder()
                        .putString(KEY_SENDER, sender)
                        .putString(KEY_MESSAGE, message)
                        .build()
                )
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                "wa-msg-$postTime-${message.hashCode()}",
                ExistingWorkPolicy.KEEP,
                request
            )
        }
    }
}
