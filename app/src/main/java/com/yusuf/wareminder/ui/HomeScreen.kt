package com.yusuf.wareminder.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.yusuf.wareminder.data.Settings

@Composable
fun HomeScreen(
    modifier: Modifier = Modifier,
    settings: Settings,
    listenerEnabled: Boolean,
    calendarPermissionGranted: Boolean,
    pendingCount: Int,
    noteCount: Int,
    onOpenListenerSettings: () -> Unit,
    onRequestPermissions: () -> Unit,
    onOpenBatterySettings: () -> Unit,
    onOpenSettings: () -> Unit,
    onToggleEnabled: (Boolean) -> Unit
) {
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Text("WA Reminder", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Membaca notifikasi WhatsApp dari nomor whitelist, lalu membuat catatan " +
                    "atau event di aplikasi Kalender bawaan HP.",
                style = MaterialTheme.typography.bodyMedium
            )
        }

        item {
            Card {
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Pemrosesan otomatis", style = MaterialTheme.typography.titleMedium)
                        Text(
                            if (settings.enabled) "Aktif" else "Dijeda",
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                    Switch(checked = settings.enabled, onCheckedChange = onToggleEnabled)
                }
            }
        }

        item {
            StatusCard(
                ok = listenerEnabled,
                title = "Akses notifikasi",
                okText = "Sudah diizinkan",
                errorText = "Belum aktif — app tidak bisa membaca pesan WhatsApp",
                actionLabel = "Buka pengaturan",
                onAction = onOpenListenerSettings
            )
        }

        item {
            StatusCard(
                ok = calendarPermissionGranted,
                title = "Izin kalender",
                okText = "Sudah diizinkan",
                errorText = "Belum diizinkan — event tidak bisa ditulis",
                actionLabel = "Minta izin",
                onAction = onRequestPermissions
            )
        }

        item {
            StatusCard(
                ok = settings.geminiApiKey.isNotBlank(),
                title = "API key Gemini",
                okText = "Sudah diisi",
                errorText = "Belum diisi — ekstraksi tidak jalan",
                actionLabel = "Ke Pengaturan",
                onAction = onOpenSettings
            )
        }

        item {
            StatusCard(
                ok = settings.whitelist.isNotEmpty(),
                title = "Whitelist nomor",
                okText = "${settings.whitelist.size} nomor diizinkan",
                errorText = "Kosong — tidak ada pesan yang akan diproses",
                actionLabel = "Ke Pengaturan",
                onAction = onOpenSettings
            )
        }

        item {
            StatusCard(
                ok = settings.calendarId > 0,
                title = "Kalender tujuan",
                okText = settings.calendarName.ifBlank { "Sudah dipilih" },
                errorText = "Belum dipilih",
                actionLabel = "Ke Pengaturan",
                onAction = onOpenSettings
            )
        }

        item {
            Card {
                Column(Modifier.padding(16.dp)) {
                    Text("Ringkasan", style = MaterialTheme.typography.titleMedium)
                    Text("Menunggu konfirmasi: $pendingCount")
                    Text("Catatan tersimpan: $noteCount")
                }
            }
        }

        item {
            Card(colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant
            )) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Catatan penting", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "• Chat yang di-mute sering tidak memunculkan notifikasi, jadi tidak terbaca.\n" +
                            "• Kalau pesan sudah dibaca di WhatsApp Web/desktop, notifikasinya bisa hilang.\n" +
                            "• Matikan optimasi baterai supaya layanan tidak dibunuh sistem.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    OutlinedButton(onClick = onOpenBatterySettings) {
                        Text("Pengaturan baterai")
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusCard(
    ok: Boolean,
    title: String,
    okText: String,
    errorText: String,
    actionLabel: String,
    onAction: () -> Unit
) {
    Card {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (ok) Icons.Default.CheckCircle else Icons.Default.Error,
                contentDescription = null,
                tint = if (ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
            )
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(
                    if (ok) okText else errorText,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            if (!ok) {
                OutlinedButton(onClick = onAction) { Text(actionLabel) }
            }
        }
    }
}
