package com.yusuf.wareminder.ui

import android.content.Intent
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
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.yusuf.wareminder.calendar.CalendarWriter
import com.yusuf.wareminder.data.NoteEntity
import com.yusuf.wareminder.util.formatDateTime

@Composable
fun NotesScreen(
    modifier: Modifier = Modifier,
    notes: List<NoteEntity>,
    timezone: String,
    onDelete: (NoteEntity) -> Unit
) {
    val context = LocalContext.current

    if (notes.isEmpty()) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Belum ada catatan", style = MaterialTheme.typography.bodyMedium)
        }
        return
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(notes, key = { it.id }) { note ->
            Card {
                Column(
                    Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(note.title, style = MaterialTheme.typography.titleMedium)
                    note.eventStart?.let {
                        Text(it.formatDateTime(timezone), style = MaterialTheme.typography.bodyMedium)
                    }
                    Text(note.body, style = MaterialTheme.typography.bodySmall)
                    Text(
                        "dari ${note.sender} • ${note.createdAt.formatDateTime(timezone)}",
                        style = MaterialTheme.typography.labelSmall
                    )
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        note.calendarEventId?.let { eventId ->
                            TextButton(onClick = {
                                val uri = CalendarWriter(context).viewEventUri(eventId)
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                                }
                            }) { Text("Buka di kalender") }
                        }
                        TextButton(onClick = { onDelete(note) }) { Text("Hapus catatan") }
                    }
                }
            }
        }
    }
}
