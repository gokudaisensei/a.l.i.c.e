package com.alice.home.domain.model

/**
 * Something Alice runs for you. One shape for the three things a person can build (the web calls them automations, scenes and
 * routines): an *automation* is started by a trigger, a *scene* sets a list of changes all at once, a *routine* runs its steps in
 * order. Plain data: no Compose types, no JSON; the ids in [Trigger.param] and [Step.target] are device, person, scene or room keys.
 */
enum class RecipeKind(val label: String) { Automation("Automation"), Scene("Scene"), Routine("Routine") }

enum class TriggerKind(val label: String) {
    Arrive("Someone gets home"), Leave("Everyone leaves"), Time("At a set time"), Sunset("At sunset"),
    DoorOpens("A door opens"), Motion("Motion is seen"), PowerOver("A plug goes over its limit"),
}

/** What starts an automation. [param] is the person ("anyone" or a name), the time ("18:30"), a device id or a room, by [kind]. */
data class Trigger(val kind: TriggerKind = TriggerKind.Arrive, val param: String? = "anyone")

enum class Days(val label: String) { Any("Any day"), Weekdays("Weekdays"), Weekends("Weekends") }

data class Conditions(val dark: Boolean = false, val someoneHome: Boolean = false, val days: Days = Days.Any, val mode: Mode? = null) {
    val none: Boolean get() = !dark && !someoneHome && days == Days.Any && mode == null
}

/** What a step does. A verb with a value has a range (a brightness, a temperature, a number of seconds). Unlocking is deliberately absent. */
enum class Verb(val label: String, val min: Int = 0, val max: Int = 0, val def: Int = 0, val unit: String = "") {
    TurnOn("Turn on"), TurnOff("Turn off"),
    Dim("Set brightness", 1, 100, 60, "%"), SetTemp("Set temperature", 16, 30, 24, "°"),
    Lock("Lock"), Notify("Send a notification"), RunScene("Run scene"),
    Wait("Wait", 1, 3600, 30, "seconds"), SetMode("Set mode");

    val hasValue: Boolean get() = max > 0

    /** A tap's worth of change: brightness in fives, degrees in ones, and waits that grow with their length. */
    fun stepFor(v: Int): Int = when (this) { Dim -> 5; Wait -> if (v < 60) 5 else if (v < 600) 30 else 60; else -> 1 }
}

data class Step(val verb: Verb, val target: String, val value: Int? = null)

data class Recipe(
    val id: String,
    val kind: RecipeKind,
    val name: String,
    val trigger: Trigger = Trigger(),
    val conditions: Conditions = Conditions(),
    val steps: List<Step> = emptyList(),
    val enabled: Boolean = true,
    val lastRun: String = "Never run",
) {
    val isNew: Boolean get() = id.isBlank()
}

/** The verbs each kind can use (a scene cannot wait; only an automation can notify). */
fun verbsFor(kind: RecipeKind): List<Verb> = when (kind) {
    RecipeKind.Automation -> listOf(Verb.TurnOn, Verb.TurnOff, Verb.Dim, Verb.SetTemp, Verb.Lock, Verb.Notify, Verb.RunScene)
    RecipeKind.Scene -> listOf(Verb.TurnOn, Verb.TurnOff, Verb.Dim, Verb.SetTemp, Verb.Lock)
    RecipeKind.Routine -> listOf(Verb.TurnOn, Verb.TurnOff, Verb.Dim, Verb.SetTemp, Verb.Lock, Verb.RunScene, Verb.SetMode, Verb.Wait)
}
