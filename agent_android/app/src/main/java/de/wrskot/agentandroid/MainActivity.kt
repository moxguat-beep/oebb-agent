package de.wrskot.agentandroid

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildScreen()
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) refreshStatus()
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }

    private fun buildScreen() {
        val padding = (20 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(padding, padding, padding, padding)
        }

        root.addView(
            TextView(this).apply {
                text = "ÖBB-Verbindungsmonitor"
                textSize = 24f
            },
            matchWidthWrapHeight(),
        )
        root.addView(
            TextView(this).apply {
                text = "Wien Hbf (U) → Trencin\n28.04.2027 · nur Direktverbindungen"
                textSize = 16f
                setPadding(0, padding / 2, 0, padding)
            },
            matchWidthWrapHeight(),
        )

        status = TextView(this).apply {
            textSize = 16f
            setPadding(0, 0, 0, padding)
        }
        root.addView(status, matchWidthWrapHeight())

        root.addView(
            Button(this).apply {
                text = "Jetzt prüfen"
                setOnClickListener { checkNow(this@MainActivity) }
            },
            matchWidthWrapHeight(),
        )

        root.addView(
            Button(this).apply {
                text = "ÖBB-Fahrplan öffnen"
                setOnClickListener {
                    startActivity(
                        Intent(
                            Intent.ACTION_VIEW,
                            Uri.parse("https://fahrplan.oebb.at/webapp/"),
                        ),
                    )
                }
            },
            matchWidthWrapHeight(),
        )

        setContentView(root)
    }

    private fun checkNow(button: Button) {
        button.isEnabled = false
        status.text = "Prüfung läuft …"
        executor.execute {
            try {
                val result = OebbApi.check()
                val checkedAt = currentTimestamp()
                preferences().edit()
                    .putBoolean(KEY_AVAILABLE, result.available)
                    .putString(KEY_CHECKED_AT, checkedAt)
                    .putString(KEY_ERROR, null)
                    .apply()
                runOnUiThread {
                    status.text = if (result.available) {
                        "Direktverbindung gefunden.\nGeprüft: $checkedAt"
                    } else {
                        "Keine Direktverbindung gelistet.\nGeprüft: $checkedAt"
                    }
                    button.isEnabled = true
                }
            } catch (error: Exception) {
                android.util.Log.e(TAG, "ÖBB-Prüfung fehlgeschlagen.", error)
                val checkedAt = currentTimestamp()
                preferences().edit()
                    .putString(KEY_ERROR, error.message ?: "Unbekannter Fehler")
                    .putString(KEY_CHECKED_AT, checkedAt)
                    .apply()
                runOnUiThread {
                    status.text = "Prüfung fehlgeschlagen.\n${error.message ?: "Unbekannter Fehler"}"
                    button.isEnabled = true
                }
            }
        }
    }

    private fun refreshStatus() {
        val prefs = preferences()
        val checkedAt = prefs.getString(KEY_CHECKED_AT, null)
        val error = prefs.getString(KEY_ERROR, null)
        status.text = when {
            error != null -> "Letzter Fehler: $error" +
                (checkedAt?.let { "\nGeprüft: $it" } ?: "")
            checkedAt == null -> "Noch keine Prüfung durchgeführt."
            prefs.getBoolean(KEY_AVAILABLE, false) ->
                "Direktverbindung gefunden.\nGeprüft: $checkedAt"
            else -> "Keine Direktverbindung gelistet.\nGeprüft: $checkedAt"
        }
    }

    private fun currentTimestamp(): String =
        ZonedDateTime.now().format(DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm"))

    private fun preferences() = getSharedPreferences(PREFERENCES, MODE_PRIVATE)

    private fun matchWidthWrapHeight() =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

    companion object {
        private const val PREFERENCES = "oebb_monitor"
        private const val KEY_AVAILABLE = "available"
        private const val KEY_CHECKED_AT = "checked_at"
        private const val KEY_ERROR = "error"
        private const val TAG = "MainActivity"
    }
}
