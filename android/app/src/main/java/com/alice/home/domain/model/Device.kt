package com.alice.home.domain.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** The kinds of device the app has a tile for. Derived from the backend's primary entity domain. */
@Serializable
enum class Kind { Light, Plug, Fan, Cover, Climate, Lock, Camera, Contact }

@Serializable
data class Device(
    val id: String,
    val name: String,
    val room: String,
    val kind: Kind,
    val on: Boolean = false,
    val level: Int = 0,
    val watts: Int = 0,
    val fav: Boolean = false,
    val voice: Boolean = false,
    val hidden: Boolean = false,
    val hardware: String = "",
    val available: Boolean = true,
    val capabilities: List<String> = emptyList(),
    val values: JsonObject = JsonObject(emptyMap()),
    // Richer state for consoles (mock phase; real backend uses values map)
    val hvacMode: String = "auto",
    val fanOscillating: Boolean = false,
    val fanPreset: String? = null,
    val colorTempKelvin: Int? = null,
    val colorRgb: List<Int>? = null,
)
