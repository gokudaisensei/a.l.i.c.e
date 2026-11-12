@file:OptIn(ExperimentalLayoutApi::class)

package com.alice.home.ui.automate

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.ShieldMoon
import androidx.compose.material.icons.rounded.WbTwilight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.alice.home.data.HouseholdState
import com.alice.home.domain.model.Days
import com.alice.home.domain.model.Mode
import com.alice.home.domain.model.Recipe
import com.alice.home.domain.model.RecipeKind
import com.alice.home.domain.model.Slot
import com.alice.home.domain.model.TriggerKind
import com.alice.home.domain.model.Verb
import com.alice.home.domain.model.verbsFor
import com.alice.home.ui.components.FilterChip
import com.alice.home.ui.components.PillButton
import com.alice.home.ui.components.SearchField
import com.alice.home.ui.components.Segmented
import com.alice.home.ui.components.Tile
import com.alice.home.ui.components.ValueStepper
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * The panel under the sentence. It shows the editor for whichever part of the sentence is open: the trigger, the conditions, one step,
 * or the list of steps to add. Everything it changes goes out as an [AutomateEvent]; the sentence above redraws from the new draft.
 */
@Composable
internal fun BuilderEditor(draft: Recipe, slot: Slot, household: HouseholdState, onEvent: (AutomateEvent) -> Unit, modifier: Modifier = Modifier) {
    val c = Alice.c
    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        // what to build can only be chosen for something new; an existing one keeps its kind
        if (draft.isNew) Segmented(RecipeKind.entries.map { it.name to it.label }, draft.kind.name, { onEvent(AutomateEvent.SetKind(RecipeKind.valueOf(it))) })
        AnimatedContent(slot, transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(110)) }, label = "editor") { s ->
            when (s) {
                Slot.When -> WhenEditor(draft, household, onEvent)
                Slot.If -> IfEditor(draft, onEvent)
                is Slot.Do -> if (s.index in draft.steps.indices) DoEditor(draft, s.index, household, onEvent) else AddEditor(draft, onEvent)
                Slot.Add -> AddEditor(draft, onEvent)
            }
        }
        SearchField(draft.name, { onEvent(AutomateEvent.SetName(it)) }, "Name this ${draft.kind.label.lowercase()}", icon = Icons.Rounded.Edit)
        Tile(color = c.tile, padding = 14.dp) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                Icon(Icons.Rounded.ShieldMoon, null, tint = c.ok, modifier = Modifier.padding(top = 1.dp))
                Text(
                    "Unlocking is never allowed in ${when (draft.kind) { RecipeKind.Automation -> "an automation"; RecipeKind.Scene -> "a scene"; RecipeKind.Routine -> "a routine" }}. " +
                        "Alice can lock a door for you, but only a person with a passkey can open one.",
                    style = AliceType.small, color = c.ink2,
                )
            }
        }
    }
}

@Composable
private fun Panel(label: String, content: @Composable () -> Unit) {
    val c = Alice.c
    Tile(color = c.tile, padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(label.uppercase(), style = AliceType.mono.copy(fontSize = androidx.compose.ui.unit.TextUnit(10.5f, androidx.compose.ui.unit.TextUnitType.Sp)), color = c.ink3)
            content()
        }
    }
}

/** A single row of choices that scrolls sideways when there are many. */
@Composable
private fun Rail(options: List<HouseholdState.Target>, selected: String?, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { FilterChip(it.name, it.id == selected, { onSelect(it.id) }) }
    }
}

@Composable
private fun WhenEditor(d: Recipe, h: HouseholdState, onEvent: (AutomateEvent) -> Unit) {
    val t = d.trigger
    Panel("When") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TriggerKind.entries.forEach { k -> FilterChip(k.label, k == t.kind, { onEvent(AutomateEvent.SetTrigger(k)) }, icon = k.icon()) }
        }
        when (t.kind) {
            TriggerKind.Arrive -> { Text("Who", style = AliceType.small, color = Alice.c.ink3); Rail(h.triggerTargets(t.kind), t.param) { onEvent(AutomateEvent.SetTriggerParam(it)) } }
            TriggerKind.DoorOpens -> { Text("Which", style = AliceType.small, color = Alice.c.ink3); Rail(h.triggerTargets(t.kind), t.param) { onEvent(AutomateEvent.SetTriggerParam(it)) } }
            TriggerKind.Motion -> { Text("Where", style = AliceType.small, color = Alice.c.ink3); Rail(h.triggerTargets(t.kind), t.param) { onEvent(AutomateEvent.SetTriggerParam(it)) } }
            TriggerKind.PowerOver -> { Text("Which plug", style = AliceType.small, color = Alice.c.ink3); Rail(h.triggerTargets(t.kind), t.param) { onEvent(AutomateEvent.SetTriggerParam(it)) } }
            TriggerKind.Time -> {
                val (hh, mm) = (t.param ?: "18:30").split(":").let { (it.getOrNull(0)?.toIntOrNull() ?: 18) to (it.getOrNull(1)?.toIntOrNull() ?: 30) }
                fun set(h2: Int, m2: Int) = onEvent(AutomateEvent.SetTriggerParam("%02d:%02d".format(h2, m2)))
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { Text("Hour", style = AliceType.small, color = Alice.c.ink3); ValueStepper(hh, { set(it, mm) }, 0..23, "") }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { Text("Minute", style = AliceType.small, color = Alice.c.ink3); ValueStepper(mm, { set(hh, it) }, 0..55, "", step = { 5 }) }
                }
            }
            TriggerKind.Leave, TriggerKind.Sunset -> Unit
        }
    }
}

@Composable
private fun IfEditor(d: Recipe, onEvent: (AutomateEvent) -> Unit) {
    val c = d.conditions
    Panel("Only if") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip("It is dark", c.dark, { onEvent(AutomateEvent.ToggleDark) }, icon = Icons.Rounded.WbTwilight)
            FilterChip("Someone is home", c.someoneHome, { onEvent(AutomateEvent.ToggleSomeoneHome) }, icon = Icons.Rounded.Home)
        }
        Text("Days", style = AliceType.small, color = Alice.c.ink3)
        Segmented(Days.entries.map { it.name to it.label }, c.days.name, { onEvent(AutomateEvent.SetDays(Days.valueOf(it))) })
        Text("Mode", style = AliceType.small, color = Alice.c.ink3)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip("Any mode", c.mode == null, { onEvent(AutomateEvent.SetConditionMode(null)) })
            Mode.entries.forEach { m -> FilterChip(m.label, c.mode == m, { onEvent(AutomateEvent.SetConditionMode(m)) }) }
        }
        Text(if (c.none) "Always: no conditions." else "Keeps it from running unless all of these are true.", style = AliceType.small, color = Alice.c.ink3)
    }
}

@Composable
private fun DoEditor(d: Recipe, i: Int, h: HouseholdState, onEvent: (AutomateEvent) -> Unit) {
    val s = d.steps[i]
    Panel("Step ${i + 1}: ${s.verb.label}") {
        if (s.verb != Verb.Wait) {
            Text(
                when (s.verb) { Verb.Notify -> "Who to tell"; Verb.RunScene -> "Which scene"; Verb.SetMode -> "Which mode"; else -> "Which one" },
                style = AliceType.small, color = Alice.c.ink3,
            )
            Rail(h.targetsFor(s.verb), s.target) { onEvent(AutomateEvent.SetStepTarget(i, it)) }
        }
        if (s.verb.hasValue) {
            Text(if (s.verb == Verb.Wait) "For how long" else if (s.verb == Verb.Dim) "How bright" else "How warm", style = AliceType.small, color = Alice.c.ink3)
            ValueStepper(s.value ?: s.verb.def, { onEvent(AutomateEvent.SetStepValue(i, it)) }, s.verb.min..s.verb.max, s.verb.unit, step = { s.verb.stepFor(it) })
        }
        Row { PillButton("Remove this step", { onEvent(AutomateEvent.RemoveStep(i)) }, color = Alice.c.crit.copy(alpha = 0.14f), ink = Alice.c.crit, icon = Icons.Rounded.Delete) }
    }
}

@Composable
private fun AddEditor(d: Recipe, onEvent: (AutomateEvent) -> Unit) {
    Panel(if (d.steps.isEmpty()) "Add a first action" else "Add an action") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            verbsFor(d.kind).forEach { v -> FilterChip(v.label, false, { onEvent(AutomateEvent.AddStep(v)) }, icon = v.icon()) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Lock, null, tint = Alice.c.ink3)
            Text("Unlock a door is not offered.", style = AliceType.small, color = Alice.c.ink3)
        }
    }
}

