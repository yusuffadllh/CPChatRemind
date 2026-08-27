package com.yusuf.wareminder

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.viewmodel.compose.viewModel
import com.yusuf.wareminder.ui.AppRoot
import com.yusuf.wareminder.ui.MainViewModel
import com.yusuf.wareminder.ui.theme.WaReminderTheme

class MainActivity : ComponentActivity() {

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* hasil dibaca ulang lewat refreshStatus() di AppRoot */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        requestPermissions()

        setContent {
            WaReminderTheme {
                val vm: MainViewModel = viewModel()
                AppRoot(
                    viewModel = vm,
                    onOpenListenerSettings = ::openListenerSettings,
                    onRequestPermissions = ::requestPermissions,
                    onOpenBatterySettings = ::openBatterySettings
                )
            }
        }
    }

    private fun requestPermissions() {
        val perms = mutableListOf(
            Manifest.permission.READ_CALENDAR,
            Manifest.permission.WRITE_CALENDAR
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms += Manifest.permission.POST_NOTIFICATIONS
        }
        permissionLauncher.launch(perms.toTypedArray())
    }

    private fun openListenerSettings() {
        runCatching {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
    }

    private fun openBatterySettings() {
        runCatching {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    companion object {
        const val EXTRA_PENDING_ID = "pending_id"
    }
}
