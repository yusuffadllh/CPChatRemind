package com.yusuf.wareminder.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.yusuf.wareminder.work.PendingResolver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Menangani tombol Setujui / Tolak di notifikasi konfirmasi.
 */
class ConfirmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val pendingId = intent.getLongExtra(EXTRA_PENDING_ID, -1L)
        if (pendingId <= 0) return

        val appContext = context.applicationContext
        val notifier = ConfirmNotifier(appContext)
        notifier.cancel(pendingId)

        val pendingResult = goAsync()
        scope.launch {
            try {
                when (intent.action) {
                    ACTION_APPROVE -> {
                        PendingResolver(appContext).approve(pendingId)
                            .onSuccess {
                                notifier.showResult(pendingId, "Tersimpan", "Sudah masuk kalender & catatan")
                            }
                            .onFailure {
                                notifier.showResult(
                                    pendingId,
                                    "Gagal menyimpan",
                                    it.message ?: "Terjadi kesalahan"
                                )
                            }
                    }

                    ACTION_REJECT -> PendingResolver(appContext).reject(pendingId)
                }
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        const val ACTION_APPROVE = "com.yusuf.wareminder.APPROVE"
        const val ACTION_REJECT = "com.yusuf.wareminder.REJECT"
        const val EXTRA_PENDING_ID = "pending_id"

        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    }
}
