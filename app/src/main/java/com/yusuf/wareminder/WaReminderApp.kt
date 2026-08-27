package com.yusuf.wareminder

import android.app.Application
import androidx.work.Configuration

class WaReminderApp : Application(), Configuration.Provider {

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(android.util.Log.INFO)
            .build()
}
