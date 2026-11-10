package com.alice.home

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bedtime
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Luggage
import androidx.compose.material.icons.rounded.MeetingRoom
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material.icons.rounded.NightsStay
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.ViewModel
import java.time.LocalTime

enum class Kind { Light, Plug, Fan, Cover }
enum class Mode(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Rounded.Home), Away("Away", Icons.Rounded.MeetingRoom),
    Night("Night", Icons.Rounded.NightsStay), Vacation("Vacation", Icons.Rounded.Luggage),
}
enum class Tod { Morning, Day, Evening, Night }

data class Device(val id: String, val name: String, val room: String, val kind: Kind, val on: Boolean = false, val level: Int = 0, val watts: Int = 0)
data class Lock(val id: String, val name: String, val locked: Boolean, val by: String)
data class Scene(val id: String, val name: String, val description: String, val icon: ImageVector)
data class Person(val name: String, val home: Boolean, val role: String)
data class Event(val text: String, val time: String, val fresh: Boolean)

fun tod(h: Int = LocalTime.now().hour) = when (h) {
    in 5..10 -> Tod.Morning; in 11..16 -> Tod.Day; in 17..20 -> Tod.Evening; else -> Tod.Night
}

/** Fake data for the design pass. Replace with the real API later. */
class HomeViewModel : ViewModel() {
    var mode by mutableStateOf(Mode.Home); private set
    var suggestion by mutableStateOf<Mode?>(Mode.Night); private set
    var alert by mutableStateOf<String?>("Water heater is at 92% of its power limit"); private set
    var target by mutableStateOf(24); private set
    var climateOn by mutableStateOf(true); private set
    var devices by mutableStateOf(
        listOf(
            Device("l1", "Floor lamp", "Living room", Kind.Light, true, 60, 9),
            Device("l2", "Ceiling light", "Living room", Kind.Light, false, 80),
            Device("f1", "Ceiling fan", "Bedroom", Kind.Fan, true, 40, 32),
            Device("c1", "Blinds", "Living room", Kind.Cover, true, 70),
            Device("p1", "Kettle", "Kitchen", Kind.Plug, false, 0, 0),
            Device("l3", "Desk lamp", "Study", Kind.Light, true, 100, 7),
        ),
    ); private set
    var locks by mutableStateOf(listOf(Lock("k1", "Front door", true, "Gokul"), Lock("k2", "Back door", true, "Asha"))); private set
    val scenes = listOf(
        Scene("s1", "Good morning", "Blinds up, lights warm", Icons.Rounded.WbSunny),
        Scene("s2", "Movie night", "Dim lights, close blinds", Icons.Rounded.Movie),
        Scene("s3", "Goodnight", "Lock up, lights off", Icons.Rounded.Bedtime),
        Scene("s4", "Away", "Everything off", Icons.Rounded.AutoAwesome),
    )
    val people = listOf(Person("Gokul", true, "Admin"), Person("Asha", true, "Member"), Person("Ravi", false, "Member"), Person("Maya", false, "Guest"))
    val energy = listOf(.4f, .35f, .3f, .32f, .5f, .8f, 1.1f, .9f, .7f, .8f, 1.2f, 1.4f, 1.0f)
    val activity = listOf(
        Event("Front door locked by Gokul", "9:42 pm", true), Event("Asha got home", "6:15 pm", true),
        Event("Goodnight scene ran", "Yesterday", false), Event("Kettle left on for 10 min", "Yesterday", false),
    )

    fun toggle(id: String) { devices = devices.map { if (it.id == id) it.copy(on = !it.on, level = if (!it.on && it.level == 0) 100 else it.level) else it } }
    fun setLevel(id: String, v: Int) { devices = devices.map { if (it.id == id) it.copy(level = v) else it } }
    /** End of a drag on a tile: 0 switches it off, anything else switches it on at that level. */
    fun commit(id: String, v: Int) { devices = devices.map { if (it.id == id) it.copy(on = v > 0, level = if (v > 0) v else it.level) else it } }
    fun toggleLock(id: String) { locks = locks.map { if (it.id == id) it.copy(locked = !it.locked, by = "You") else it } }
    fun lockAll() { locks = locks.map { it.copy(locked = true, by = "You") } }
    fun chooseMode(m: Mode) { mode = m; if (suggestion == m) suggestion = null }
    fun dismissSuggestion() { suggestion = null }
    fun ack() { alert = null }
    /** False when it hit an end of the range. */
    fun step(d: Int): Boolean { val n = (target + d).coerceIn(16, 30); val moved = n != target; target = n; return moved }
    fun toggleClimate() { climateOn = !climateOn }
    val kw get() = devices.filter { it.on }.sumOf { it.watts } / 1000f + 0.35f
}
