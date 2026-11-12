package com.alice.home.ui.automate

import com.alice.home.domain.model.Days
import com.alice.home.domain.model.Mode
import com.alice.home.domain.model.RecipeKind
import com.alice.home.domain.model.Slot
import com.alice.home.domain.model.TriggerKind
import com.alice.home.domain.model.Verb

/** Everything the person can do on the Automate tab, named for what they did. */
sealed interface AutomateEvent {
    // the list
    data class Focus(val key: String) : AutomateEvent
    data class SetEnabled(val id: String, val enabled: Boolean) : AutomateEvent
    data class Run(val id: String) : AutomateEvent

    // opening and closing the builder
    data object New : AutomateEvent
    data class Edit(val id: String) : AutomateEvent
    data object Close : AutomateEvent

    // building
    data class SetKind(val kind: RecipeKind) : AutomateEvent
    data class SelectSlot(val slot: Slot) : AutomateEvent
    data class SetName(val name: String) : AutomateEvent
    data class SetTrigger(val kind: TriggerKind) : AutomateEvent
    data class SetTriggerParam(val param: String) : AutomateEvent
    data object ToggleDark : AutomateEvent
    data object ToggleSomeoneHome : AutomateEvent
    data class SetDays(val days: Days) : AutomateEvent
    data class SetConditionMode(val mode: Mode?) : AutomateEvent
    data class AddStep(val verb: Verb) : AutomateEvent
    data class SetStepTarget(val index: Int, val target: String) : AutomateEvent
    data class SetStepValue(val index: Int, val value: Int) : AutomateEvent
    data class RemoveStep(val index: Int) : AutomateEvent

    // finishing
    data object Save : AutomateEvent
    data object DryRun : AutomateEvent
    data object Delete : AutomateEvent

    data object DismissToast : AutomateEvent
}
