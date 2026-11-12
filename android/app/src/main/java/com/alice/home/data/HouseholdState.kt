package com.alice.home.data

import com.alice.home.domain.model.Device
import com.alice.home.domain.model.Event
import com.alice.home.domain.model.Lock
import com.alice.home.domain.model.Mode
import com.alice.home.domain.model.Person
import com.alice.home.domain.model.Names
import com.alice.home.domain.model.Recipe
import com.alice.home.domain.model.RecipeKind
import com.alice.home.domain.model.Scene
import com.alice.home.domain.model.TriggerKind
import com.alice.home.domain.model.Verb
import com.alice.home.domain.model.Kind

/**
 * Everything the household is, as one immutable snapshot. This is the single source of truth the UI
 * renders; it is produced by the repository and never mutated by a screen.
 *
 * Derived values live here so they are computed once, from one snapshot, instead of being
 * re-derived (and drifting) inside composables.
 */
data class HouseholdState(
    val mode: Mode = Mode.Home,
    val suggestion: Mode? = null,
    val alert: String? = null,
    val target: Int = 24,
    val role: String = "admin",
    val devices: List<Device> = emptyList(),
    val locks: List<Lock> = emptyList(),
    val scenes: List<Scene> = emptyList(),
    val people: List<Person> = emptyList(),
    val invites: List<com.alice.home.domain.model.Invite> = emptyList(),
    val activity: List<Event> = emptyList(),
    val energy: List<Float> = emptyList(),
    /** Everything the household has built: automations, scenes and routines (the Automate tab). */
    val recipes: List<Recipe> = emptyList(),
    /** Backups, health, updates, support access and alert preferences (the Settings sheet). */
    val admin: com.alice.home.domain.model.AdminState = com.alice.home.domain.model.AdminState(),
) {
    /** Live draw, as the home screen shows it. */
    val kw: Float get() = devices.filter { it.on }.sumOf { it.watts } / 1000f + 0.35f

    /** What the Home screen shows as favourites: favourite devices that are not hidden. */
    val favourites: List<Device> get() = devices.filter { it.fav && !it.hidden }

    val unlockedCount: Int get() = locks.count { !it.locked }
    val homeCount: Int get() = people.count { it.home }
    val newActivityCount: Int get() = activity.count { it.fresh }

    /** True when something on the home screen needs a person's attention. */
    val needsAttention: Boolean get() = alert != null || unlockedCount > 0

    // ---- the Automate tab

    val automationCount: Int get() = recipes.count { it.kind == RecipeKind.Automation }
    val automationsOn: Int get() = recipes.count { it.kind == RecipeKind.Automation && it.enabled }
    val sceneCount: Int get() = recipes.count { it.kind == RecipeKind.Scene }
    val routineCount: Int get() = recipes.count { it.kind == RecipeKind.Routine }

    /** A thing a step or trigger can point at, with the words to show for it. */
    data class Target(val id: String, val name: String)

    private val usable: List<Device> get() = devices.filter { !it.hidden }

    /** What a step with this verb can act on in this home. A verb nothing can do returns an empty list. */
    fun targetsFor(verb: Verb): List<Target> = when (verb) {
        Verb.TurnOn, Verb.TurnOff -> usable.filter { it.kind in setOf(Kind.Light, Kind.Plug, Kind.Fan, Kind.Climate) }.map { Target(it.id, it.name) }
        Verb.Dim -> usable.filter { it.kind == Kind.Light && "brightness" in it.capabilities }.map { Target(it.id, it.name) }
        Verb.SetTemp -> usable.filter { it.kind == Kind.Climate }.map { Target(it.id, it.name) }
        Verb.Lock -> usable.filter { it.kind == Kind.Lock }.map { Target(it.id, it.name) }
        Verb.Notify -> people.filter { it.role != "Guest" }.map { Target(it.name, it.name) }
        Verb.RunScene -> recipes.filter { it.kind == RecipeKind.Scene }.map { Target(it.id, it.name) }
        Verb.Wait -> listOf(Target("wait", "then"))
        Verb.SetMode -> Mode.entries.map { Target(it.name, it.label) }
    }

    /** What a trigger's parameter can be, for the kinds that have one. */
    fun triggerTargets(kind: TriggerKind): List<Target> = when (kind) {
        TriggerKind.Arrive -> listOf(Target("anyone", "Anyone")) + people.filter { it.role != "Guest" }.map { Target(it.name, it.name) }
        TriggerKind.DoorOpens -> usable.filter { it.kind == Kind.Contact || it.kind == Kind.Cover }.map { Target(it.id, it.name) }
        TriggerKind.Motion -> usable.map { it.room }.distinct().sorted().map { Target(it, it) }
        TriggerKind.PowerOver -> usable.filter { it.kind == Kind.Plug }.map { Target(it.id, it.name) }
        else -> emptyList()
    }

    /** The words for the keys inside a recipe. */
    fun names(): Names = Names(
        device = { id -> devices.firstOrNull { it.id == id }?.name ?: id.ifBlank { "something" } },
        person = { id -> people.firstOrNull { it.name == id }?.name ?: id },
        scene = { id -> recipes.firstOrNull { it.id == id }?.name ?: scenes.firstOrNull { it.id == id }?.name ?: "a scene" },
    )
}
