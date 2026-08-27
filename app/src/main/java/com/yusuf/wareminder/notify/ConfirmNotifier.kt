package com.yusuf.wareminder.notify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.yusuf.wareminder.MainActivity
import com.yusuf.wareminder.R
import com.yusuf.wareminder.data.PendingEntity
import com.yusuf.wareminder.data.PendingType
import com.yusuf.wareminder.util.formatDateTime

class ConfirmNotifier(private val context: Context) {

    fun showConfirmation(pending: PendingEntity, timezone: String = TIMEZONE_FALLBACK) {
        ensureChannel()

        val label = if (pending.type == PendingType.EVENT) "Event baru" else "Catatan baru"
        val timeLine = pending.startMillis?.formatDateTime(timezone)
        val body = buildString {
            if (timeLine != null) appendLine(timeLine)
            append(pending.body.take(200))
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle("$label: ${pending.title}")
            .setContentText(timeLine ?: pending.body.take(80))
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSubText("dari ${pending.sender}")
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(pending.id))
            .addAction(
                0, "Setujui",
                actionIntent(ConfirmReceiver.ACTION_APPROVE, pending.id)
            )
            .addAction(
                0, "Tolak",
                actionIntent(ConfirmReceiver.ACTION_REJECT, pending.id)
            )
            .build()

        runCatching {
            NotificationManagerCompat.from(context).notify(pending.id.toInt(), notification)
        }
    }

    fun cancel(pendingId: Long) {
        NotificationManagerCompat.from(context).cancel(pendingId.toInt())
    }

    fun showResult(pendingId: Long, title: String, message: String) {
        ensureChannel()
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_note)
            .setContentTitle(title)
            .setContentText(message)
            .setAutoCancel(true)
            .setTimeoutAfter(RESULT_TIMEOUT_MILLIS)
            .setContentIntent(openAppIntent(pendingId))
            .build()
        runCatching {
            NotificationManagerCompat.from(context).notify(RESULT_ID_OFFSET + pendingId.toInt(), notification)
        }
    }

    private fun openAppIntent(pendingId: Long): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_PENDING_ID, pendingId)
        }
        return PendingIntent.getActivity(
            context, pendingId.toInt(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun actionIntent(action: String, pendingId: Long): PendingIntent {
        val intent = Intent(context, ConfirmReceiver::class.java).apply {
            this.action = action
            putExtra(ConfirmReceiver.EXTRA_PENDING_ID, pendingId)
        }
        return PendingIntent.getBroadcast(
            context, (action + pendingId).hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun ensureChannel() {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Konfirmasi catatan & event",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Minta persetujuan sebelum menyimpan hasil dari pesan WhatsApp"
            }
        )
    }

    companion object {
        const val CHANNEL_ID = "confirm"
        private const val RESULT_ID_OFFSET = 900_000
        private const val RESULT_TIMEOUT_MILLIS = 10_000L
        private const val TIMEZONE_FALLBACK = "Asia/Jakarta"
    }
}
