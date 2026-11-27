package com.xboxlocalhub.network

import android.content.Context
import android.net.Uri

/**
 * Relay endpoint + optional access token. The token is part of the dashboard
 * URL (query string) exactly like the web flow; it is never written to logs.
 */
object RelayConfig {
    private const val PREFS = "xlh.relay"
    private const val KEY_URL = "url"
    private const val KEY_TOKEN = "token"
    const val DEFAULT_URL = "http://127.0.0.1:8787"

    data class Config(val url: String, val token: String)

    fun load(context: Context): Config {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Config(
            url = prefs.getString(KEY_URL, DEFAULT_URL) ?: DEFAULT_URL,
            token = prefs.getString(KEY_TOKEN, "") ?: "",
        )
    }

    fun save(context: Context, url: String, token: String): Config {
        val normalized = normalizeUrl(url)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_URL, normalized)
            .putString(KEY_TOKEN, token.trim())
            .apply()
        return Config(normalized, token.trim())
    }

    fun normalizeUrl(input: String): String {
        var value = input.trim()
        if (value.isEmpty()) value = DEFAULT_URL
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://$value"
        }
        return value.trimEnd('/')
    }

    fun dashboardUrl(config: Config): String {
        val base = normalizeUrl(config.url)
        return if (config.token.isBlank()) {
            "$base/"
        } else {
            "$base/?token=${Uri.encode(config.token)}"
        }
    }

    fun dashboardUrl(context: Context): String = dashboardUrl(load(context))
}
