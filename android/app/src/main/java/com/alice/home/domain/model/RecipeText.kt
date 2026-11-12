package com.alice.home.domain.model

/** How to turn the keys inside a [Recipe] into words. Supplied by whoever knows the household. */
class Names(val device: (String) -> String, val person: (String) -> String, val scene: (String) -> String)

/** Which part of a recipe a tap on a piece of its sentence edits. */
sealed interface Slot {
    data object When : Slot
    data object If : Slot
    data class Do(val index: Int) : Slot
    /** Adding a new step. */
    data object Add : Slot
}

enum class Role { Plain, When, If, Do }

/** One piece of a recipe's sentence: a plain word, or a part that can be tapped to change it ([slot] is not null). */
data class Piece(val text: String, val role: Role = Role.Plain, val slot: Slot? = null)

fun fmtTime(t: String?): String {
    val (h, m) = (t ?: "18:30").split(":").map { it.toIntOrNull() ?: 0 }.let { (it.getOrNull(0) ?: 18) to (it.getOrNull(1) ?: 30) }
    return "${(h + 11) % 12 + 1}:${m.toString().padStart(2, '0')} ${if (h < 12) "am" else "pm"}"
}

fun Trigger.text(n: Names): String = when (kind) {
    TriggerKind.Arrive -> "${if (param == null || param == "anyone") "someone" else n.person(param)} gets home"
    TriggerKind.Leave -> "everyone has left"
    TriggerKind.Time -> "it is ${fmtTime(param)}"
    TriggerKind.Sunset -> "the sun sets"
    TriggerKind.DoorOpens -> "${n.device(param.orEmpty())} opens"
    TriggerKind.Motion -> "motion is seen in ${param.orEmpty()}"
    TriggerKind.PowerOver -> "${n.device(param.orEmpty())} goes over its limit"
}

/** The conditions as one phrase ("it is dark and someone is home"), or null when there are none. */
fun Conditions.text(): String? {
    val parts = buildList {
        if (dark) add("it is dark")
        if (someoneHome) add("someone is home")
        if (days == Days.Weekdays) add("it is a weekday")
        if (days == Days.Weekends) add("it is a weekend")
        if (mode != null) add("the mode is ${mode.label}")
    }
    return if (parts.isEmpty()) null else joinWords(parts)
}

fun Step.text(n: Names): String {
    val t = if (verb == Verb.RunScene) n.scene(target) else n.device(target)
    return when (verb) {
        Verb.TurnOn -> "turn on $t"; Verb.TurnOff -> "turn off $t"
        Verb.Dim -> "set $t to ${value ?: verb.def}%"; Verb.SetTemp -> "set $t to ${value ?: verb.def}°"
        Verb.Lock -> "lock $t"; Verb.Notify -> "send ${n.person(target)} a notification"
        Verb.RunScene -> "run the “$t” scene"; Verb.Wait -> "wait ${value ?: verb.def} seconds"
        Verb.SetMode -> "switch to $target mode"
    }
}

fun joinWords(a: List<String>): String = if (a.size < 2) a.joinToString("") else a.dropLast(1).joinToString(", ") + " and " + a.last()

/**
 * The recipe as a sentence made of pieces, to be drawn with the tappable ones highlighted: "When [someone gets home] if [it is dark]
 * then [turn on Floor lamp] and [lock Front door] [+ action]". A scene starts "All at once:" and a routine "In order:".
 */
fun Recipe.pieces(n: Names): List<Piece> = buildList {
    when (kind) {
        RecipeKind.Automation -> {
            add(Piece("When")); add(Piece(trigger.text(n), Role.When, Slot.When))
            val c = conditions.text()
            if (c != null) { add(Piece("if")); add(Piece(c, Role.If, Slot.If)) } else add(Piece("+ condition", Role.If, Slot.If))
            add(Piece("then"))
        }
        RecipeKind.Scene -> add(Piece("All at once:"))
        RecipeKind.Routine -> add(Piece("In order:"))
    }
    steps.forEachIndexed { i, s ->
        if (i > 0) add(Piece(if (kind == RecipeKind.Routine) "then" else "and"))
        add(Piece(s.text(n), Role.Do, Slot.Do(i)))
    }
    add(Piece("+ action", Role.Do, Slot.Add))
}

/** The recipe as one plain sentence, for a list row. */
fun Recipe.plain(n: Names): String {
    val acts = steps.map { it.text(n) }
    val body = when (kind) {
        RecipeKind.Automation -> "When ${trigger.text(n)}${conditions.text()?.let { ", if $it" }.orEmpty()}, ${if (acts.isEmpty()) "do nothing" else joinWords(acts)}."
        RecipeKind.Scene -> "All at once: ${if (acts.isEmpty()) "nothing yet" else joinWords(acts)}."
        RecipeKind.Routine -> "In order: ${if (acts.isEmpty()) "nothing yet" else acts.joinToString(", then ")}."
    }
    return body
}
