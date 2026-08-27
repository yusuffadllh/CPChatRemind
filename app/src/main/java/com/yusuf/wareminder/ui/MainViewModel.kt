package com.yusuf.wareminder.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.yusuf.wareminder.calendar.CalendarInfo
import com.yusuf.wareminder.calendar.CalendarWriter
import com.yusuf.wareminder.data.AppDatabase
import com.yusuf.wareminder.data.NoteEntity
import com.yusuf.wareminder.data.PendingEntity
import com.yusuf.wareminder.data.PendingStatus
import com.yusuf.wareminder.data.Settings
import com.yusuf.wareminder.data.SettingsStore
import com.yusuf.wareminder.notify.ConfirmNotifier
import com.yusuf.wareminder.service.WaNotificationListener
import com.yusuf.wareminder.work.PendingResolver
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val db = AppDatabase.get(app)
    private val settingsStore = SettingsStore(app)
    private val calendarWriter = CalendarWriter(app)
    private val resolver = PendingResolver(app)
    private val notifier = ConfirmNotifier(app)

    val settings: StateFlow<Settings> = settingsStore.settings
        .stateIn(viewModelScope, SharingStarted.Eagerly, Settings())

    val pending: StateFlow<List<PendingEntity>> =
        db.pendingDao().observeByStatus(PendingStatus.WAITING)
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val notes: StateFlow<List<NoteEntity>> = db.noteDao().observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _calendars = MutableStateFlow<List<CalendarInfo>>(emptyList())
    val calendars: StateFlow<List<CalendarInfo>> = _calendars.asStateFlow()

    private val _listenerEnabled = MutableStateFlow(WaNotificationListener.isEnabled(app))
    val listenerEnabled: StateFlow<Boolean> = _listenerEnabled.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    fun refreshStatus() {
        _listenerEnabled.value = WaNotificationListener.isEnabled(getApplication())
        refreshCalendars()
    }

    fun refreshCalendars() {
        _calendars.value = calendarWriter.listWritableCalendars()
    }

    fun consumeMessage() {
        _message.value = null
    }

    fun approve(id: Long) = viewModelScope.launch {
        notifier.cancel(id)
        resolver.approve(id)
            .onSuccess { _message.value = "Tersimpan" }
            .onFailure { _message.value = it.message ?: "Gagal menyimpan" }
    }

    fun reject(id: Long) = viewModelScope.launch {
        notifier.cancel(id)
        resolver.reject(id)
        _message.value = "Ditolak"
    }

    fun updatePending(item: PendingEntity) = viewModelScope.launch {
        db.pendingDao().update(item)
    }

    fun deleteNote(note: NoteEntity) = viewModelScope.launch {
        db.noteDao().delete(note)
    }

    fun setApiKey(value: String) = viewModelScope.launch { settingsStore.setApiKey(value) }

    fun setWhitelist(values: List<String>) = viewModelScope.launch {
        settingsStore.setWhitelist(values)
    }

    fun setRequireKeyword(value: Boolean) = viewModelScope.launch {
        settingsStore.setRequireKeyword(value)
    }

    fun setKeywords(values: List<String>) = viewModelScope.launch {
        settingsStore.setKeywords(values)
    }

    fun setCalendar(info: CalendarInfo) = viewModelScope.launch {
        settingsStore.setCalendar(info.id, info.displayName)
    }

    fun setReminderMinutes(value: Int) = viewModelScope.launch {
        settingsStore.setReminderMinutes(value)
    }

    fun setTimezone(value: String) = viewModelScope.launch { settingsStore.setTimezone(value) }

    fun setAutoApprove(value: Boolean) = viewModelScope.launch {
        settingsStore.setAutoApprove(value)
    }

    fun setAutoReply(value: Boolean) = viewModelScope.launch {
        settingsStore.setAutoReply(value)
    }

    fun setEnabled(value: Boolean) = viewModelScope.launch { settingsStore.setEnabled(value) }
}
