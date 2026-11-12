package com.alice.home.data.mock

import com.alice.home.data.AliceRepository
import com.alice.home.data.HouseholdState
import kotlinx.serialization.json.JsonObject
import com.alice.home.domain.model.Device
import com.alice.home.domain.model.Event
import com.alice.home.domain.model.Kind
import com.alice.home.domain.model.Lock
import com.alice.home.domain.model.Mode
import com.alice.home.domain.model.Person
import com.alice.home.domain.model.Scene
import com.alice.home.domain.model.Conditions
import com.alice.home.domain.model.Days
import com.alice.home.domain.model.AdminState
import com.alice.home.domain.model.Backup
import com.alice.home.domain.model.BackupSettings
import com.alice.home.domain.model.Health
import com.alice.home.domain.model.HealthCheck
import com.alice.home.domain.model.PastUpdate
import com.alice.home.domain.model.Prefs
import com.alice.home.domain.model.SupportAccess
import com.alice.home.domain.model.UpdateInfo
import com.alice.home.domain.model.Recipe
import com.alice.home.domain.model.RecipeKind
import com.alice.home.domain.model.Step
import com.alice.home.domain.model.Trigger
import com.alice.home.domain.model.TriggerKind
import com.alice.home.domain.model.Verb
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The design-pass stand-in for the real repository, kept while `backend-kt` is being built.
 *
 * It holds the same fake household the app has always shown and implements the same contract the
 * real one will, so nothing above this file changes when the ported backend lands. Replace this
 * class with `DefaultAliceRepository`; leave [AliceRepository] alone.
 */
class MockAliceRepository : AliceRepository {

    private val _state = MutableStateFlow(
        HouseholdState(
            mode = Mode.Home,
            suggestion = Mode.Night,
            alert = "Water heater is at 92% of its power limit",
            target = 24,
            devices = listOf(
                Device("l1", "Floor lamp", "Living room", Kind.Light, true, 60, 9, fav = true, voice = true, hardware = "Philips Hue", capabilities = listOf("power","brightness","color_temperature","color")),
                Device("l2", "Ceiling light", "Living room", Kind.Light, false, 80, hardware = "Philips Hue", capabilities = listOf("power","brightness")),
                Device("f1", "Ceiling fan", "Bedroom", Kind.Fan, true, 40, 32, fav = true, voice = true, hardware = "Hunter", capabilities = listOf("power","fan_speed","oscillation")),
                Device("c1", "Blinds", "Living room", Kind.Cover, true, 70, hardware = "IKEA", capabilities = listOf("cover","position")),
                Device("p1", "Kettle", "Kitchen", Kind.Plug, false, 0, 0, voice = true, hardware = "TP-Link", capabilities = listOf("power")),
                Device("l3", "Desk lamp", "Study", Kind.Light, true, 100, 7, fav = true, hardware = "IKEA", capabilities = listOf("power","brightness")),
                Device("cl1", "Living room AC", "Living room", Kind.Climate, true, 0, 0, fav = true, hardware = "Daikin", capabilities = listOf("power","hvac_mode","target_temperature","fan_mode")),
                Device("lock1", "Front door", "Hallway", Kind.Lock, true, 0, 0, fav = true, hardware = "Yale", available = true, capabilities = listOf("lock")),
                Device("cam1", "Garden camera", "Garden", Kind.Camera, true, 0, 0, hidden = false, hardware = "Reolink", capabilities = listOf("camera")),
                Device("ct1", "Window sensor", "Bedroom", Kind.Contact, false, 0, 0, hardware = "Aqara", capabilities = listOf("binary_sensor")),
                Device("l4", "Bedside lamp", "Bedroom", Kind.Light, false, 30, hardware = "IKEA", hidden = true, capabilities = listOf("power","brightness")),
                Device("p2", "TV plug", "Living room", Kind.Plug, true, 0, 120, voice = true, hardware = "TP-Link", capabilities = listOf("power")),
                // more rooms and brands, for richer data: new rooms, a long name, an unavailable device, a hidden one
                Device("l5", "Living room corner reading lamp with dimmer", "Living room", Kind.Light, true, 45, 6, hardware = "Philips Hue", capabilities = listOf("power","brightness","color_temperature")),
                Device("l6", "Dining pendant", "Dining room", Kind.Light, true, 70, 11, fav = true, hardware = "IKEA", capabilities = listOf("power","brightness")),
                Device("l7", "Dining table strip", "Dining room", Kind.Light, false, 50, hardware = "Philips Hue", capabilities = listOf("power","brightness","color")),
                Device("c2", "Dining blinds", "Dining room", Kind.Cover, false, 0, hardware = "IKEA", capabilities = listOf("cover","position")),
                Device("l8", "Bathroom mirror light", "Bathroom", Kind.Light, false, 90, hardware = "Philips Hue", capabilities = listOf("power","brightness")),
                Device("f2", "Extractor fan", "Bathroom", Kind.Fan, false, 0, 0, hardware = "Hunter", capabilities = listOf("power","fan_speed")),
                Device("p3", "Towel warmer", "Bathroom", Kind.Plug, true, 0, 85, hardware = "TP-Link", capabilities = listOf("power")),
                Device("l9", "Night light", "Kids room", Kind.Light, true, 10, 1, hardware = "IKEA", capabilities = listOf("power","brightness")),
                Device("cl2", "Kids room AC", "Kids room", Kind.Climate, false, 0, 0, hardware = "Daikin", capabilities = listOf("power","hvac_mode","target_temperature","fan_mode")),
                Device("ct2", "Kids room window", "Kids room", Kind.Contact, false, 0, 0, hardware = "Aqara", capabilities = listOf("binary_sensor")),
                Device("l10", "Garage light", "Garage", Kind.Light, false, 100, hardware = "Philips Hue", capabilities = listOf("power","brightness")),
                Device("c3", "Garage door", "Garage", Kind.Cover, false, 0, hardware = "Chamberlain", capabilities = listOf("cover","position")),
                Device("p4", "EV charger", "Garage", Kind.Plug, true, 0, 1800, hardware = "Wallbox", capabilities = listOf("power")),
                Device("cam2", "Garage camera", "Garage", Kind.Camera, true, 0, 0, hardware = "Reolink", capabilities = listOf("camera")),
                Device("p5", "Washing machine", "Laundry", Kind.Plug, true, 0, 410, hardware = "TP-Link", capabilities = listOf("power")),
                Device("p6", "Dryer", "Laundry", Kind.Plug, false, 0, 0, hardware = "TP-Link", capabilities = listOf("power")),
                Device("ct3", "Laundry leak sensor", "Laundry", Kind.Contact, false, 0, 0, hardware = "Aqara", capabilities = listOf("binary_sensor")),
                Device("l11", "Garden path lights", "Garden", Kind.Light, false, 60, hardware = "Philips Hue", capabilities = listOf("power","brightness")),
                Device("lock2", "Back door", "Garden", Kind.Lock, true, 0, 0, hardware = "Yale", capabilities = listOf("lock")),
                Device("p7", "Garden sprinkler", "Garden", Kind.Plug, false, 0, 0, hardware = "Rachio", capabilities = listOf("power")),
                Device("l12", "Kitchen counter light", "Kitchen", Kind.Light, true, 85, 8, fav = true, hardware = "IKEA", capabilities = listOf("power","brightness")),
                Device("p8", "Coffee machine", "Kitchen", Kind.Plug, false, 0, 0, voice = true, hardware = "TP-Link", capabilities = listOf("power")),
                Device("p9", "Dishwasher", "Kitchen", Kind.Plug, false, 0, 0, hardware = "Bosch", available = false, capabilities = listOf("power")),
                Device("cl3", "Bedroom AC", "Bedroom", Kind.Climate, false, 0, 0, hardware = "Daikin", capabilities = listOf("power","hvac_mode","target_temperature","fan_mode")),
                Device("l13", "Study ceiling light", "Study", Kind.Light, false, 70, hardware = "Philips Hue", capabilities = listOf("power","brightness","color_temperature")),
                Device("p10", "Monitor plug", "Study", Kind.Plug, true, 0, 45, hardware = "TP-Link", capabilities = listOf("power")),
                Device("l14", "Hall light", "Hallway", Kind.Light, true, 55, 5, hardware = "Philips Hue", capabilities = listOf("power","brightness")),
                Device("l15", "Old hall lamp", "Hallway", Kind.Light, false, 20, hardware = "IKEA", hidden = true, capabilities = listOf("power","brightness")),
            ),
            locks = listOf(Lock("k1", "Front door", true, "Gokul"), Lock("k2", "Back door", true, "Asha")),
            scenes = listOf(
                Scene("s1", "Good morning", "Blinds up, lights warm", "sun"),
                Scene("s2", "Movie night", "Dim lights, close blinds", "play"),
                Scene("s3", "Goodnight", "Lock up, lights off", "moon"),
                Scene("s4", "Away", "Everything off", "exit"),
            ),
            people = listOf(
                Person("Gokul", true, "Admin", me = true), Person("Asha", true, "Member"),
                Person("Ravi", false, "Member"), Person("Maya", false, "Guest", endsAt = "tomorrow, 6:00 pm", devices = setOf("l1", "l2")),
            ),
            energy = listOf(.4f, .35f, .3f, .32f, .5f, .8f, 1.1f, .9f, .7f, .8f, 1.2f, 1.4f, 1.0f),
            // The same four scenes Home shows (same ids), now with what they do, plus automations and routines.
            admin = AdminState(
                backups = listOf(
                    Backup("b1", "Alice", "last night, 2:00 am", "18 MB", "This server", true),
                    Backup("b2", "Home Assistant", "last night, 2:05 am", "212 MB", "This server", null),
                    Backup("b3", "Alice", "2 days ago", "18 MB", "This server", true),
                    Backup("b4", "Alice", "3 days ago", "17 MB", "This server", false, ok = false),
                ),
                checks = listOf(
                    HealthCheck("Database", Health.Ok, "Responding in 4 ms"), HealthCheck("Home Assistant", Health.Ok, "Connected, 12 devices"),
                    HealthCheck("Config helper", Health.Ok, "Idle"), HealthCheck("Push alerts", Health.Warn, "Not set up on this server"),
                ),
                update = UpdateInfo("1.4.2", available = "1.5.0", notes = listOf("Faster device updates", "Fixes a rare lock status delay"), signed = true),
                pastUpdates = listOf(PastUpdate("1.4.1", "1.4.2", "Automatic", true, "last week")),
            ),
            invites = listOf(com.alice.home.domain.model.Invite("i1", "Guest", "tomorrow, 9:00 am")),
            recipes = listOf(
                Recipe("a1", RecipeKind.Automation, "Lights on when I get home", Trigger(TriggerKind.Arrive, "anyone"), Conditions(dark = true),
                    listOf(Step(Verb.TurnOn, "l1"), Step(Verb.Dim, "l1", 70)), true, "Last run: yesterday, 6:15 pm"),
                Recipe("a2", RecipeKind.Automation, "Goodnight lock-up", Trigger(TriggerKind.Time, "22:30"), Conditions(someoneHome = true),
                    listOf(Step(Verb.Lock, "lock1"), Step(Verb.TurnOff, "l2"), Step(Verb.TurnOff, "l3")), true, "Last run: yesterday, 10:30 pm"),
                Recipe("a3", RecipeKind.Automation, "Kettle left on", Trigger(TriggerKind.PowerOver, "p1"), Conditions(),
                    listOf(Step(Verb.Notify, "Gokul")), false, "Never run"),
                Recipe("s1", RecipeKind.Scene, "Good morning", steps = listOf(Step(Verb.TurnOn, "l1"), Step(Verb.Dim, "l1", 80), Step(Verb.TurnOn, "f1")), lastRun = "Last run: today, 6:45 am"),
                Recipe("s2", RecipeKind.Scene, "Movie night", steps = listOf(Step(Verb.Dim, "l1", 20), Step(Verb.TurnOff, "l2"), Step(Verb.Dim, "l3", 15)), lastRun = "Last run: saturday"),
                Recipe("s3", RecipeKind.Scene, "Goodnight", steps = listOf(Step(Verb.TurnOff, "l1"), Step(Verb.TurnOff, "l2"), Step(Verb.Lock, "lock1")), lastRun = "Last run: yesterday, 10:31 pm"),
                Recipe("s4", RecipeKind.Scene, "Away", steps = listOf(Step(Verb.TurnOff, "l1"), Step(Verb.TurnOff, "l2"), Step(Verb.TurnOff, "l3"), Step(Verb.TurnOff, "f1"), Step(Verb.TurnOff, "cl1")), lastRun = "Never run"),
                Recipe("r1", RecipeKind.Routine, "Leaving home", steps = listOf(Step(Verb.RunScene, "s4"), Step(Verb.Wait, "wait", 30), Step(Verb.Lock, "lock1"), Step(Verb.SetMode, "Away")), lastRun = "Last run: monday"),
                Recipe("r2", RecipeKind.Routine, "Wind down", steps = listOf(Step(Verb.SetMode, "Night"), Step(Verb.Wait, "wait", 300), Step(Verb.TurnOff, "l3")), lastRun = "Never run"),
            ),
            activity = listOf(
                Event("Front door locked by Gokul", "9:42 pm", true),
                Event("Asha got home", "6:15 pm", true),
                Event("Goodnight scene ran", "Yesterday", false),
                Event("Kettle left on for 10 min", "Yesterday", false),
            ),
        ),
    )

    override val state: StateFlow<HouseholdState> = _state.asStateFlow()

    /** Nothing to fetch from a mock; the real repository refetches here after a socket reconnect. */
    override fun refresh() = Unit

    override fun toggleDevice(id: String) = _state.update { s ->
        s.copy(devices = s.devices.map {
            if (it.id == id) it.copy(on = !it.on, level = if (!it.on && it.level == 0) 100 else it.level) else it
        })
    }

    override fun commitLevel(id: String, level: Int) = _state.update { s ->
        s.copy(devices = s.devices.map {
            if (it.id == id) it.copy(on = level > 0, level = if (level > 0) level else it.level) else it
        })
    }

    override fun toggleLock(id: String) = _state.update { s ->
        s.copy(locks = s.locks.map { if (it.id == id) it.copy(locked = !it.locked, by = "You") else it })
    }

    override fun lockAll() = _state.update { s ->
        s.copy(locks = s.locks.map { it.copy(locked = true, by = "You") })
    }

    override fun chooseMode(mode: Mode) = _state.update { s ->
        s.copy(mode = mode, suggestion = if (s.suggestion == mode) null else s.suggestion)
    }

    override fun dismissSuggestion() = _state.update { it.copy(suggestion = null) }

    override fun acknowledgeAlert() = _state.update { it.copy(alert = null) }

    override fun stepTarget(delta: Int) = _state.update { s ->
        s.copy(target = (s.target + delta).coerceIn(16, 30))
    }

    override fun toggleFavourite(id: String) = _state.update { s ->
        s.copy(devices = s.devices.map { if (it.id == id) it.copy(fav = !it.fav) else it })
    }

    override fun toggleVoice(id: String) = _state.update { s ->
        s.copy(devices = s.devices.map { if (it.id == id) it.copy(voice = !it.voice) else it })
    }

    override fun setHidden(id: String, hidden: Boolean) = _state.update { s ->
        s.copy(devices = s.devices.map { if (it.id == id) it.copy(hidden = hidden) else it })
    }

    override fun setHvacMode(id: String, mode: String) = _state.update { s ->
        s.copy(devices = s.devices.map { if (it.id == id) it.copy(hvacMode = mode) else it })
    }

    override fun setOscillation(id: String, on: Boolean) = _state.update { s ->
        s.copy(devices = s.devices.map { if (it.id == id) it.copy(fanOscillating = on) else it })
    }

    override fun setColorTemp(id: String, kelvin: Int) = _state.update { s ->
        s.copy(devices = s.devices.map { if (it.id == id) it.copy(colorTempKelvin = kelvin) else it })
    }

    override fun setColor(id: String, rgb: List<Int>) = _state.update { s ->
        s.copy(devices = s.devices.map { if (it.id == id) it.copy(colorRgb = rgb) else it })
    }

    override fun setFanPreset(id: String, preset: String) = _state.update { s ->
        s.copy(devices = s.devices.map { if (it.id == id) it.copy(fanPreset = preset) else it })
    }

    override fun saveRecipe(recipe: Recipe) = _state.update { s ->
        if (recipe.isNew) s.copy(recipes = s.recipes + recipe.copy(id = "n" + System.nanoTime()))
        else s.copy(recipes = s.recipes.map { if (it.id == recipe.id) recipe else it })
    }

    override fun deleteRecipe(id: String) = _state.update { s -> s.copy(recipes = s.recipes.filter { it.id != id }) }

    override fun setRecipeEnabled(id: String, enabled: Boolean) = _state.update { s ->
        s.copy(recipes = s.recipes.map { if (it.id == id) it.copy(enabled = enabled) else it })
    }

    override fun runRecipe(id: String) = _state.update { s ->
        s.copy(recipes = s.recipes.map { if (it.id == id) it.copy(lastRun = "Last run: just now") else it })
    }

    override fun setRole(name: String, role: String) = _state.update { s ->
        s.copy(people = s.people.map { if (it.name == name && !it.me) it.copy(role = role, endsAt = if (role == "Guest") it.endsAt else null, devices = if (role == "Guest") (it.devices ?: emptySet()) else it.devices) else it })
    }

    override fun setDeviceAccess(name: String, devices: Set<String>?) = _state.update { s ->
        s.copy(people = s.people.map { if (it.name == name && it.role != "Admin") it.copy(devices = devices) else it })
    }

    override fun removeMember(name: String) = _state.update { s -> s.copy(people = s.people.filter { it.name != name || it.me }) }

    override fun createInvite(role: String, hours: Int): String {
        val chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
        val code = (0 until 8).map { chars.random() }.joinToString("").chunked(4).joinToString("-")
        val label = if (hours >= 168) "in 7 days" else if (hours >= 24) "tomorrow" else "in 1 hour"
        _state.update { s -> s.copy(invites = s.invites + com.alice.home.domain.model.Invite("n" + System.nanoTime(), role, label)) }
        return code
    }

    override fun revokeInvite(id: String) = _state.update { s -> s.copy(invites = s.invites.filter { it.id != id }) }

    private fun admin(f: (AdminState) -> AdminState) = _state.update { it.copy(admin = f(it.admin)) }

    override fun backUpNow() = admin { it.copy(backups = listOf(Backup("n" + System.nanoTime(), "Alice", "just now", "18 MB", "This server", null)) + it.backups) }
    override fun verifyBackup(id: String) = admin { a -> a.copy(backups = a.backups.map { if (it.id == id) it.copy(verified = true) else it }) }
    override fun deleteBackup(id: String) = admin { a -> a.copy(backups = a.backups.filter { it.id != id }) }
    override fun restoreBackup(id: String) = Unit
    override fun setBackupSettings(s: BackupSettings) = admin { it.copy(backupSettings = s) }
    override fun recheckHealth() = admin { it }
    override fun setAutoUpdate(on: Boolean) = admin { it.copy(update = it.update.copy(autoUpdate = on)) }
    override fun installUpdate(now: Boolean) = admin { a ->
        val u = a.update
        if (now) a.copy(update = UpdateInfo(u.available ?: u.current, autoUpdate = u.autoUpdate, window = u.window), pastUpdates = listOf(PastUpdate(u.current, u.available ?: u.current, "By an admin", true, "just now")) + a.pastUpdates)
        else a.copy(update = u.copy(scheduled = true))
    }
    override fun cancelUpdateSchedule() = admin { it.copy(update = it.update.copy(scheduled = false)) }
    override fun grantSupport(hours: Int, scope: Set<String>) = admin { it.copy(support = SupportAccess("$hours h", scope)) }
    override fun endSupport() = admin { it.copy(support = SupportAccess()) }
    override fun setPrefs(p: Prefs) = admin { it.copy(prefs = p) }
}
