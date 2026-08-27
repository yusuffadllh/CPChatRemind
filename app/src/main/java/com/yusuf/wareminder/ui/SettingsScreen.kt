package com.yusuf.wareminder.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.yusuf.wareminder.calendar.CalendarInfo
import com.yusuf.wareminder.data.Settings

@Composable
fun SettingsScreen(
    modifier: Modifier = Modifier,
    settings: Settings,
    calendars: List<CalendarInfo>,
    onRefreshCalendars: () -> Unit,
    onApiKeyChange: (String) -> Unit,
    onWhitelistChange: (List<String>) -> Unit,
    onRequireKeywordChange: (Boolean) -> Unit,
    onKeywordsChange: (List<String>) -> Unit,
    onCalendarChange: (CalendarInfo) -> Unit,
    onReminderMinutesChange: (Int) -> Unit,
    onTimezoneChange: (String) -> Unit,
    onAutoApproveChange: (Boolean) -> Unit,
    onAutoReplyChange: (Boolean) -> Unit
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item { ApiKeySection(settings.geminiApiKey, onApiKeyChange) }
        item { WhitelistSection(settings.whitelist, onWhitelistChange) }
        item {
            KeywordSection(
                requireKeyword = settings.requireKeyword,
                keywords = settings.keywords,
                onRequireKeywordChange = onRequireKeywordChange,
                onKeywordsChange = onKeywordsChange
            )
        }
        item {
            CalendarSection(
                calendars = calendars,
                selectedId = settings.calendarId,
                onRefresh = onRefreshCalendars,
                onSelect = onCalendarChange
            )
        }
        item {
            ReminderSection(
                minutes = settings.reminderMinutesBefore,
                timezone = settings.timezone,
                autoApprove = settings.autoApprove,
                autoReply = settings.autoReply,
                onMinutesChange = onReminderMinutesChange,
                onTimezoneChange = onTimezoneChange,
                onAutoApproveChange = onAutoApproveChange,
                onAutoReplyChange = onAutoReplyChange
            )
        }
    }
}

@Composable
private fun SectionCard(
    title: String,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            content()
        }
    }
}

@Composable
private fun ApiKeySection(current: String, onSave: (String) -> Unit) {
    var value by remember(current) { mutableStateOf(current) }
    var visible by remember { mutableStateOf(false) }

    SectionCard(
        title = "API key Gemini",
        subtitle = "Ambil gratis di Google AI Studio. Key disimpan lokal di HP, tidak dikirim ke mana pun selain Google."
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = { value = it },
            label = { Text("API key") },
            singleLine = true,
            visualTransformation = if (visible) {
                VisualTransformation.None
            } else {
                PasswordVisualTransformation()
            },
            trailingIcon = {
                IconButton(onClick = { visible = !visible }) {
                    Icon(
                        if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = if (visible) "Sembunyikan" else "Tampilkan"
                    )
                }
            },
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedButton(
            onClick = { onSave(value) },
            enabled = value != current
        ) { Text("Simpan key") }
    }
}

@Composable
private fun WhitelistSection(current: List<String>, onSave: (List<String>) -> Unit) {
    var text by remember(current) { mutableStateOf(current.joinToString("\n")) }

    SectionCard(
        title = "Whitelist pengirim",
        subtitle = "Satu nomor per baris. Boleh 08xx, +62xx, atau nama kontak persis seperti " +
            "yang muncul di notifikasi. Kosong = tidak ada pesan yang diproses."
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            label = { Text("Nomor / nama kontak") },
            placeholder = { Text("+6281234567890\nDiri Sendiri") },
            minLines = 3,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedButton(onClick = { onSave(text.lines()) }) { Text("Simpan whitelist") }
    }
}

@Composable
private fun KeywordSection(
    requireKeyword: Boolean,
    keywords: List<String>,
    onRequireKeywordChange: (Boolean) -> Unit,
    onKeywordsChange: (List<String>) -> Unit
) {
    var text by remember(keywords) { mutableStateOf(keywords.joinToString(", ")) }

    SectionCard(
        title = "Filter kata kunci",
        subtitle = "Kalau aktif, hanya pesan yang diawali salah satu kata kunci yang diproses."
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Wajib pakai kata kunci")
            Switch(checked = requireKeyword, onCheckedChange = onRequireKeywordChange)
        }
        if (requireKeyword) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                label = { Text("Kata kunci (pisahkan koma)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedButton(onClick = { onKeywordsChange(text.split(',')) }) {
                Text("Simpan kata kunci")
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CalendarSection(
    calendars: List<CalendarInfo>,
    selectedId: Long,
    onRefresh: () -> Unit,
    onSelect: (CalendarInfo) -> Unit
) {
    LaunchedEffect(Unit) { onRefresh() }

    SectionCard(
        title = "Kalender tujuan",
        subtitle = "Event ditulis ke aplikasi Kalender bawaan HP lewat CalendarContract."
    ) {
        if (calendars.isEmpty()) {
            Text(
                "Belum ada kalender yang bisa ditulisi. Pastikan izin kalender sudah diberikan " +
                    "dan ada minimal satu akun kalender di HP.",
                style = MaterialTheme.typography.bodySmall
            )
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                calendars.forEach { cal ->
                    FilterChip(
                        selected = cal.id == selectedId,
                        onClick = { onSelect(cal) },
                        label = { Text(cal.displayName) }
                    )
                }
            }
            calendars.firstOrNull { it.id == selectedId }?.let {
                Text("Akun: ${it.accountName}", style = MaterialTheme.typography.labelSmall)
            }
        }
        OutlinedButton(onClick = onRefresh) { Text("Muat ulang daftar") }
    }
}

@Composable
private fun ReminderSection(
    minutes: Int,
    timezone: String,
    autoApprove: Boolean,
    autoReply: Boolean,
    onMinutesChange: (Int) -> Unit,
    onTimezoneChange: (String) -> Unit,
    onAutoApproveChange: (Boolean) -> Unit,
    onAutoReplyChange: (Boolean) -> Unit
) {
    var minutesText by remember(minutes) { mutableStateOf(minutes.toString()) }
    var tzText by remember(timezone) { mutableStateOf(timezone) }

    SectionCard(title = "Pengingat & lainnya") {
        OutlinedTextField(
            value = minutesText,
            onValueChange = { input ->
                minutesText = input.filter { it.isDigit() }.take(4)
            },
            label = { Text("Ingatkan berapa menit sebelum acara") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedButton(
            onClick = { minutesText.toIntOrNull()?.let(onMinutesChange) },
            enabled = minutesText.toIntOrNull() != null && minutesText.toIntOrNull() != minutes
        ) { Text("Simpan pengingat") }

        OutlinedTextField(
            value = tzText,
            onValueChange = { tzText = it },
            label = { Text("Timezone") },
            placeholder = { Text("Asia/Jakarta") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedButton(
            onClick = { onTimezoneChange(tzText) },
            enabled = tzText.isNotBlank() && tzText != timezone
        ) { Text("Simpan timezone") }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text("Simpan otomatis")
                Text(
                    "Lewati konfirmasi, langsung tulis ke kalender & catatan",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Switch(checked = autoApprove, onCheckedChange = onAutoApproveChange)
        }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text("Balas otomatis di WhatsApp")
                Text(
                    "Kirim \u2705 / \u274C ke chat lewat tombol Reply di notifikasi",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Switch(checked = autoReply, onCheckedChange = onAutoReplyChange)
        }
    }
}
