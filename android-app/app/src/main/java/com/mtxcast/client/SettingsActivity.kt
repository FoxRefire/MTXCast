package com.mtxcast.client

import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.mtxcast.client.databinding.ActivitySettingsBinding

class SettingsActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySettingsBinding
    private lateinit var settingsManager: SettingsManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        settingsManager = SettingsManager(this)

        // Load current settings
        binding.editServerUrl.setText(settingsManager.serverUrl)
        binding.editApiToken.setText(settingsManager.apiToken ?: "")

        // Save button
        binding.buttonSave.setOnClickListener {
            saveSettings()
        }

        supportActionBar?.setDisplayHomeAsUpEnabled(true)
    }

    private fun saveSettings() {
        val serverUrl = binding.editServerUrl.text.toString().trim()
        val apiToken = binding.editApiToken.text.toString().trim()

        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "Server URL cannot be empty", Toast.LENGTH_SHORT).show()
            return
        }

        // Validate URL format
        if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
            Toast.makeText(this, "Server URL must start with http:// or https://", Toast.LENGTH_SHORT).show()
            return
        }

        settingsManager.serverUrl = serverUrl
        settingsManager.apiToken = if (apiToken.isEmpty()) null else apiToken

        Toast.makeText(this, getString(R.string.settings_saved), Toast.LENGTH_SHORT).show()
        finish()
    }

    override fun onSupportNavigateUp(): Boolean {
        onBackPressed()
        return true
    }
}
