package com.mtxcast.client

import android.content.Context
import android.content.SharedPreferences

class SettingsManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(
        "mtxcast_prefs",
        Context.MODE_PRIVATE
    )

    var serverUrl: String
        get() = prefs.getString("server_url", "http://127.0.0.1:8080") ?: "http://127.0.0.1:8080"
        set(value) = prefs.edit().putString("server_url", value).apply()

    var apiToken: String?
        get() = prefs.getString("api_token", null)
        set(value) = prefs.edit().putString("api_token", value).apply()

    fun clear() {
        prefs.edit().clear().apply()
    }
}
