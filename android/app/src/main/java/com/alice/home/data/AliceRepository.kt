package com.alice.home.data

import com.alice.home.domain.model.Mode
import com.alice.home.domain.model.Recipe
import kotlinx.coroutines.flow.StateFlow

/**
 * The app's single source of truth for household state.
 *
 * One instance, app-scoped, created in [com.alice.home.di.AppGraph]. It owns transport, caching,
 * retries and the device-command lifecycle; nothing above it knows where the data comes from.
 *
 * Commands are deliberately fire-and-forget: they apply an optimistic update, then reconcile from
 * the backend (`command.confirmed` / `command.failed` / `command.timed_out`). A screen must never
 * assume a command completed.
 */
interface AliceRepository {
    /** The current snapshot. Collect it; never mutate it. */
    val state: StateFlow<HouseholdState>

    /** Refetch everything. `/ws` has no replay, so this runs on cold start and on socket reconnect. */
    fun refresh()

    fun toggleDevice(id: String)

    /** End of a level gesture: 0 switches the device off, anything else switches it on at that level. */
    fun commitLevel(id: String, level: Int)

    fun toggleLock(id: String)
    fun lockAll()

    fun toggleFavourite(id: String)
    fun toggleVoice(id: String)
    fun setHidden(id: String, hidden: Boolean)

    fun setHvacMode(id: String, mode: String)
    fun setOscillation(id: String, on: Boolean)
    fun setColorTemp(id: String, kelvin: Int)
    fun setColor(id: String, rgb: List<Int>)
    fun setFanPreset(id: String, preset: String)

    /** Creates a recipe (a blank id means new) or replaces the one with the same id. The real repository writes it into Home Assistant. */
    fun saveRecipe(recipe: Recipe)
    fun deleteRecipe(id: String)
    fun setRecipeEnabled(id: String, enabled: Boolean)
    /** Runs a scene or routine now. */
    fun runRecipe(id: String)

    fun setRole(name: String, role: String)
    fun removeMember(name: String)
    /** Sets the devices a person may use; null gives access to all. */
    fun setDeviceAccess(name: String, devices: Set<String>?)
    /** Makes a one-time invite and returns its code, which is the only time it is available. */
    fun createInvite(role: String, hours: Int): String
    fun revokeInvite(id: String)

    // ---- Settings
    fun backUpNow()
    fun verifyBackup(id: String)
    fun deleteBackup(id: String)
    fun restoreBackup(id: String)
    fun setBackupSettings(s: com.alice.home.domain.model.BackupSettings)
    fun recheckHealth()
    fun setAutoUpdate(on: Boolean)
    /** Installs the waiting update: now, or in the next window. */
    fun installUpdate(now: Boolean)
    fun cancelUpdateSchedule()
    fun grantSupport(hours: Int, scope: Set<String>)
    fun endSupport()
    fun setPrefs(p: com.alice.home.domain.model.Prefs)

    fun chooseMode(mode: Mode)
    fun dismissSuggestion()
    fun acknowledgeAlert()

    /** Moves the climate target by [delta] within the device's allowed range. */
    fun stepTarget(delta: Int)
}
