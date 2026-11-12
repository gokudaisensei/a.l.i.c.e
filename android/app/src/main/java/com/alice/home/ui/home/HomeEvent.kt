package com.alice.home.ui.home

import com.alice.home.domain.model.Mode

/**
 * Everything the user can do on the home screen, named for what they did rather than what to set.
 * The ViewModel's `when` is exhaustive, so adding an interaction forces every handler to be updated.
 */
sealed interface HomeEvent {
    data class ToggleDevice(val id: String) : HomeEvent
    data class CommitLevel(val id: String, val level: Int) : HomeEvent

    data class SetHvacMode(val id: String, val mode: String) : HomeEvent
    data class SetOscillation(val id: String, val on: Boolean) : HomeEvent
    data class SetColorTemp(val id: String, val kelvin: Int) : HomeEvent
    data class SetColor(val id: String, val rgb: List<Int>) : HomeEvent
    data class SetFanPreset(val id: String, val preset: String) : HomeEvent

    data class ToggleLock(val id: String) : HomeEvent
    data object LockAll : HomeEvent

    data class ChooseMode(val mode: Mode) : HomeEvent
    data object DismissSuggestion : HomeEvent
    data object AcknowledgeAlert : HomeEvent
    data class StepTarget(val delta: Int) : HomeEvent

    data object EnterEdit : HomeEvent
    data object ExitEdit : HomeEvent
    data class RemoveFavourite(val id: String) : HomeEvent
    data class SelectCard(val id: String) : HomeEvent
    data class ResizeCard(val id: String, val size: com.alice.home.ui.components.DeviceCardSize) : HomeEvent
    /** Moves a card [by] places in the order (negative is earlier): a card widened at the screen's edge makes room by moving left. */
    data class MoveCard(val id: String, val by: Int) : HomeEvent
    data object ResetLayout : HomeEvent

    data object ToggleActivity : HomeEvent
    data class RunScene(val name: String) : HomeEvent

    data object Refresh : HomeEvent
    data object DismissToast : HomeEvent
}
