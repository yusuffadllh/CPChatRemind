package com.yusuf.wareminder.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.yusuf.wareminder.data.PendingEntity
import com.yusuf.wareminder.data.PendingType
import com.yusuf.wareminder.util.formatDateTime
import com.yusuf.wareminder.util.parseLocalDateTime
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun PendingScreen(
    modifier: Modifier = Modifier,
    items: List<PendingEntity>,
    timezone: String,
    onApprove: (Long) -> Unit,
    onReject: (Long) -> Unit,
    onUpdate: (PendingEntity) -> Unit
) {
    var editing by remember { mutableStateOf<PendingEntity?>(null) }

    if (items.isEmpty()) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(
                "Belum ada yang menunggu konfirmasi",
                style = MaterialTheme.typography.bodyMedium
            )
        }
        return
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(items, key = { it.id }) { item ->
            Card {
                Column(
                    Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            item.title,
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f)
                        )
                        AssistChip(
                            onClick = {},
                            label = {
                                Text(if (item.type == PendingType.EVENT) "Event" else "Catatan")
                            }
                        )
                    }

                    item.startMillis?.let {
                        Text(it.formatDateTime(timezone), style = MaterialTheme.typography.bodyMedium)
                    }
                    if (!item.location.isNullOrBlank()) {
                        Text("Lokasi: ${item.location}", style = MaterialTheme.typography.bodySmall)
                    }
                    Text(item.body, style = MaterialTheme.typography.bodySmall)
                    Text(
                        "dari ${item.sender} • keyakinan ${(item.confidence * 100).toInt()}%",
                        style = MaterialTheme.typography.labelSmall
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { onApprove(item.id) }) { Text("Setujui") }
                        TextButton(onClick = { editing = item }) { Text("Edit") }
                        TextButton(onClick = { onReject(item.id) }) { Text("Tolak") }
                    }
                }
            }
        }
    }

    editing?.let { item ->
        EditPendingDialog(
            item = item,
            timezone = timezone,
            onDismiss = { editing = null },
            onSave = {
                onUpdate(it)
                editing = null
            }
        )
    }
}

@Composable
private fun EditPendingDialog(
    item: PendingEntity,
    timezone: String,
    onDismiss: () -> Unit,
    onSave: (PendingEntity) -> Unit
) {
    var title by remember { mutableStateOf(item.title) }
    var body by remember { mutableStateOf(item.body) }
    var start by remember { mutableStateOf(item.startMillis?.toIsoLocal(timezone) ?: "") }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Edit sebelum disimpan") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Judul") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("Isi / detail") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = start,
                    onValueChange = { start = it; error = null },
                    label = { Text("Waktu mulai") },
                    placeholder = { Text("2026-08-26T15:00") },
                    supportingText = {
                        Text(error ?: "Kosongkan kalau ini catatan biasa")
                    },
                    isError = error != null,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(onClick = {
                val trimmed = start.trim()
                val millis = if (trimmed.isEmpty()) null else trimmed.parseLocalDateTime(timezone)
                if (trimmed.isNotEmpty() && millis == null) {
                    error = "Format tidak dikenali"
                    return@Button
                }
                onSave(
                    item.copy(
                        title = title.trim().ifEmpty { item.title },
                        body = body.trim(),
                        startMillis = millis,
                        endMillis = if (millis == null) null else item.endMillis,
                        type = if (millis == null) PendingType.NOTE else PendingType.EVENT
                    )
                )
            }) { Text("Simpan perubahan") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Batal") } }
    )
}

private val isoLocalMinutes = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")

private fun Long.toIsoLocal(timezone: String): String {
    val zone = runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() }
    return Instant.ofEpochMilli(this).atZone(zone).format(isoLocalMinutes)
}
