package com.xboxlocalhub.diagnostics

import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Small in-memory ring buffer mirrored to the RN diagnostics screen. */
object DiagnosticsLog {
    private const val MAX = 300
    private val entries = ArrayDeque<String>()
    private val formatter = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    @Synchronized
    fun add(scope: String, message: String) {
        entries.addLast("${formatter.format(Date())} [$scope] $message")
        while (entries.size > MAX) entries.removeFirst()
    }

    @Synchronized
    fun snapshot(): List<String> = entries.toList()

    @Synchronized
    fun clear() {
        entries.clear()
    }

    @Synchronized
    fun toJson(): String {
        val array = JSONArray()
        entries.forEach { array.put(it) }
        return array.toString()
    }
}
