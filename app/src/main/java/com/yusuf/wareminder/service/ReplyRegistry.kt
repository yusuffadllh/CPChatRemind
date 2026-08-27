package com.yusuf.wareminder.service

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle

/**
 * Membalas chat lewat action "Reply" di notifikasi WhatsApp (mekanisme yang sama
 * dipakai smartwatch). Tidak menyentuh internal WhatsApp sama sekali.
 */
class ReplyHandle(private val action: Notification.Action) {

    fun send(context: Context, text: String): Boolean {
        val inputs = action.remoteInputs?.takeIf { it.isNotEmpty() } ?: return false
        val intent = Intent()
        val results = Bundle().apply {
            inputs.forEach { putCharSequence(it.resultKey, text) }
        }
        RemoteInput.addResultsToIntent(inputs, intent, results)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            RemoteInput.setResultsSource(intent, RemoteInput.SOURCE_FREE_FORM_INPUT)
        }
        return try {
            action.actionIntent.send(context, 0, intent)
            true
        } catch (e: PendingIntent.CanceledException) {
            false
        }
    }

    companion object {
        fun from(notification: Notification): ReplyHandle? {
            val action = notification.actions?.firstOrNull { candidate ->
                candidate.remoteInputs?.any { it.allowFreeFormInput } == true
            }
            return action?.let(::ReplyHandle)
        }
    }
}

/**
 * PendingIntent balasan hanya hidup selama notifikasi aslinya masih valid,
 * jadi disimpan di memori per pengirim sampai hasil ekstraksi selesai.
 */
object ReplyRegistry {

    private const val MAX_ENTRIES = 50
    private val handles = LinkedHashMap<String, ReplyHandle>()

    @Synchronized
    fun put(sender: String, handle: ReplyHandle) {
        if (handles.size >= MAX_ENTRIES) {
            handles.remove(handles.keys.first())
        }
        handles[sender] = handle
    }

    @Synchronized
    fun get(sender: String): ReplyHandle? = handles[sender]

    fun reply(context: Context, sender: String, text: String): Boolean =
        get(sender)?.send(context, text) ?: false
}
