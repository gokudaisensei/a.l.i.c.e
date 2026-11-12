package com.alice.home.ui.automate

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alice.home.data.AliceRepository
import com.alice.home.domain.model.Recipe
import com.alice.home.domain.model.RecipeKind
import com.alice.home.domain.model.Slot
import com.alice.home.domain.model.Step
import com.alice.home.domain.model.Trigger
import com.alice.home.domain.model.TriggerKind
import com.alice.home.domain.model.joinWords
import com.alice.home.domain.model.text
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

class AutomateViewModel(private val repository: AliceRepository) : ViewModel() {

    private val screen = MutableStateFlow(ScreenState())
    private val household get() = repository.state.value

    val uiState: StateFlow<AutomateUiState> = combine(repository.state, screen) { h, s ->
        AutomateUiState(household = h, builder = s.builder, focus = s.focus, toast = s.toast)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, AutomateUiState(household = repository.state.value))

    fun onEvent(event: AutomateEvent) {
        when (event) {
            is AutomateEvent.Focus -> screen.update { it.copy(focus = event.key) }
            is AutomateEvent.SetEnabled -> {
                repository.setRecipeEnabled(event.id, event.enabled)
                val name = household.recipes.firstOrNull { it.id == event.id }?.name.orEmpty()
                toast(if (event.enabled) "$name is on" else "$name is off")
            }
            is AutomateEvent.Run -> {
                repository.runRecipe(event.id)
                toast("${household.recipes.firstOrNull { it.id == event.id }?.name.orEmpty()} started")
            }

            AutomateEvent.New -> screen.update { it.copy(builder = Builder(blank(RecipeKind.Automation), Slot.When)) }
            is AutomateEvent.Edit -> household.recipes.firstOrNull { it.id == event.id }?.let { r ->
                screen.update { it.copy(builder = Builder(r, if (r.kind == RecipeKind.Automation) Slot.When else if (r.steps.isEmpty()) Slot.Add else Slot.Do(0))) }
            }
            AutomateEvent.Close -> screen.update { it.copy(builder = null) }

            // a new kind starts from an empty draft, as on the web; an existing recipe keeps its kind
            is AutomateEvent.SetKind -> screen.update { s ->
                if (s.builder?.draft?.isNew != true) s
                else s.copy(builder = Builder(blank(event.kind), if (event.kind == RecipeKind.Automation) Slot.When else Slot.Add))
            }
            is AutomateEvent.SelectSlot -> screen.update { s -> s.builder?.let { s.copy(builder = it.copy(slot = event.slot)) } ?: s }
            is AutomateEvent.SetName -> edit { it.copy(name = event.name) }

            is AutomateEvent.SetTrigger -> {
                val targets = household.triggerTargets(event.kind)
                val needsOne = event.kind in setOf(TriggerKind.DoorOpens, TriggerKind.Motion, TriggerKind.PowerOver)
                if (needsOne && targets.isEmpty()) toast("Nothing in your home can do that yet")
                else edit { it.copy(trigger = Trigger(event.kind, when (event.kind) {
                    TriggerKind.Time -> "18:30"
                    TriggerKind.Leave, TriggerKind.Sunset -> null
                    else -> targets.firstOrNull()?.id
                })) }
            }
            is AutomateEvent.SetTriggerParam -> edit { it.copy(trigger = it.trigger.copy(param = event.param)) }
            AutomateEvent.ToggleDark -> edit { it.copy(conditions = it.conditions.copy(dark = !it.conditions.dark)) }
            AutomateEvent.ToggleSomeoneHome -> edit { it.copy(conditions = it.conditions.copy(someoneHome = !it.conditions.someoneHome)) }
            is AutomateEvent.SetDays -> edit { it.copy(conditions = it.conditions.copy(days = event.days)) }
            is AutomateEvent.SetConditionMode -> edit { it.copy(conditions = it.conditions.copy(mode = event.mode)) }

            is AutomateEvent.AddStep -> {
                val first = household.targetsFor(event.verb).firstOrNull()
                if (first == null) toast("Nothing in your home can do that yet")
                else screen.update { s ->
                    s.builder?.let { b ->
                        val steps = b.draft.steps + Step(event.verb, first.id, if (event.verb.hasValue) event.verb.def else null)
                        s.copy(builder = Builder(b.draft.copy(steps = steps), Slot.Do(steps.lastIndex)))
                    } ?: s
                }
            }
            is AutomateEvent.SetStepTarget -> editStep(event.index) { it.copy(target = event.target) }
            is AutomateEvent.SetStepValue -> editStep(event.index) { it.copy(value = event.value) }
            is AutomateEvent.RemoveStep -> screen.update { s ->
                s.builder?.let { b ->
                    val steps = b.draft.steps.filterIndexed { i, _ -> i != event.index }
                    s.copy(builder = Builder(b.draft.copy(steps = steps), if (steps.isEmpty()) Slot.Add else Slot.Do(minOf(event.index, steps.lastIndex))))
                } ?: s
            }

            AutomateEvent.Save -> screen.value.builder?.draft?.let { d ->
                if (d.steps.isEmpty()) toast("Add at least one action first")
                else {
                    val name = d.name.trim().ifBlank { "${d.kind.label} ${household.recipes.count { it.kind == d.kind } + 1}" }
                    repository.saveRecipe(d.copy(name = name))
                    screen.update { it.copy(builder = null, toast = "$name saved") }
                }
            }
            AutomateEvent.DryRun -> screen.value.builder?.draft?.let { d ->
                val n = household.names()
                toast(if (d.steps.isEmpty()) "Nothing to run yet. Add an action" else "Dry run: Alice would ${joinWords(d.steps.map { it.text(n) })}. Nothing changed")
            }
            AutomateEvent.Delete -> screen.value.builder?.draft?.let { d ->
                if (!d.isNew) { repository.deleteRecipe(d.id); screen.update { it.copy(builder = null, toast = "${d.name} removed") } }
            }

            AutomateEvent.DismissToast -> screen.update { it.copy(toast = null) }
        }
    }

    private fun blank(kind: RecipeKind) = Recipe(id = "", kind = kind, name = "")
    private fun toast(text: String) = screen.update { it.copy(toast = text) }
    private fun edit(f: (Recipe) -> Recipe) = screen.update { s -> s.builder?.let { s.copy(builder = it.copy(draft = f(it.draft))) } ?: s }
    private fun editStep(i: Int, f: (Step) -> Step) = edit { d -> d.copy(steps = d.steps.mapIndexed { j, s -> if (j == i) f(s) else s }) }

    private data class ScreenState(val builder: Builder? = null, val focus: String? = null, val toast: String? = null)
}
