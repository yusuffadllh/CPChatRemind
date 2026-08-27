package com.yusuf.wareminder.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notes
import androidx.compose.material.icons.filled.PendingActions
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleResumeEffect

private enum class Tab(val label: String, val icon: ImageVector) {
    HOME("Beranda", Icons.Default.Home),
    PENDING("Konfirmasi", Icons.Default.PendingActions),
    NOTES("Catatan", Icons.Default.Notes),
    SETTINGS("Pengaturan", Icons.Default.Settings)
}

@Composable
fun AppRoot(
    viewModel: MainViewModel,
    onOpenListenerSettings: () -> Unit,
    onRequestPermissions: () -> Unit,
    onOpenBatterySettings: () -> Unit
) {
    var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
    val snackbarHost = remember { SnackbarHostState() }

    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val pending by viewModel.pending.collectAsStateWithLifecycle()
    val notes by viewModel.notes.collectAsStateWithLifecycle()
    val calendars by viewModel.calendars.collectAsStateWithLifecycle()
    val listenerEnabled by viewModel.listenerEnabled.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()

    // Status izin & listener bisa berubah di luar app, cek ulang tiap kembali ke foreground.
    LifecycleResumeEffect(Unit) {
        viewModel.refreshStatus()
        onPauseOrDispose { }
    }

    LaunchedEffect(message) {
        message?.let {
            snackbarHost.showSnackbar(it)
            viewModel.consumeMessage()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHost) },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { item ->
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = { tab = item },
                        icon = {
                            if (item == Tab.PENDING && pending.isNotEmpty()) {
                                BadgedBox(badge = { Badge { Text("${pending.size}") } }) {
                                    Icon(item.icon, contentDescription = item.label)
                                }
                            } else {
                                Icon(item.icon, contentDescription = item.label)
                            }
                        },
                        label = { Text(item.label) }
                    )
                }
            }
        }
    ) { innerPadding ->
        val contentModifier = Modifier.padding(innerPadding)
        when (tab) {
            Tab.HOME -> HomeScreen(
                modifier = contentModifier,
                settings = settings,
                listenerEnabled = listenerEnabled,
                calendarPermissionGranted = calendars.isNotEmpty() || settings.calendarId > 0,
                pendingCount = pending.size,
                noteCount = notes.size,
                onOpenListenerSettings = onOpenListenerSettings,
                onRequestPermissions = onRequestPermissions,
                onOpenBatterySettings = onOpenBatterySettings,
                onOpenSettings = { tab = Tab.SETTINGS },
                onToggleEnabled = viewModel::setEnabled
            )

            Tab.PENDING -> PendingScreen(
                modifier = contentModifier,
                items = pending,
                timezone = settings.timezone,
                onApprove = viewModel::approve,
                onReject = viewModel::reject,
                onUpdate = viewModel::updatePending
            )

            Tab.NOTES -> NotesScreen(
                modifier = contentModifier,
                notes = notes,
                timezone = settings.timezone,
                onDelete = viewModel::deleteNote
            )

            Tab.SETTINGS -> SettingsScreen(
                modifier = contentModifier,
                settings = settings,
                calendars = calendars,
                onRefreshCalendars = viewModel::refreshCalendars,
                onApiKeyChange = viewModel::setApiKey,
                onWhitelistChange = viewModel::setWhitelist,
                onRequireKeywordChange = viewModel::setRequireKeyword,
                onKeywordsChange = viewModel::setKeywords,
                onCalendarChange = viewModel::setCalendar,
                onReminderMinutesChange = viewModel::setReminderMinutes,
                onTimezoneChange = viewModel::setTimezone,
                onAutoApproveChange = viewModel::setAutoApprove,
                onAutoReplyChange = viewModel::setAutoReply
            )
        }
    }
}
