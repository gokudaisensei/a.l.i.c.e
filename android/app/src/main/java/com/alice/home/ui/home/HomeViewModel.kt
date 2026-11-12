package com.alice.home.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alice.home.data.AliceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * The home screen's state holder. It does not fetch anything: it maps the repository's snapshot plus
 * its own screen state into [HomeUiState], and forwards [HomeEvent]s to the repository.
 *
 * Keeping it this thin is the point — it is testable with a fake repository and has no Android
 * dependencies beyond `ViewModel`.
 */
class HomeViewModel(private val repository: AliceRepository) : ViewModel() {

    private val screen = MutableStateFlow(ScreenState())

    val uiState: StateFlow<HomeUiState> = combine(repository.state, screen) { household, s ->
        HomeUiState(household = household, activityOpen = s.activityOpen, editMode = s.editMode, selectedId = s.selectedId, sizes = s.sizes, order = s.order, toast = s.toast)
    }.stateIn(
        scope = viewModelScope,
        // Eager, with a real initial value, so the first frame already has the household instead of
        // flashing an empty screen while the flow starts.
        started = SharingStarted.Eagerly,
        initialValue = HomeUiState(household = repository.state.value),
    )

    fun onEvent(event: HomeEvent) {
        when (event) {
            is HomeEvent.ToggleDevice -> repository.toggleDevice(event.id)
            is HomeEvent.CommitLevel -> repository.commitLevel(event.id, event.level)

            is HomeEvent.SetHvacMode -> repository.setHvacMode(event.id, event.mode)
            is HomeEvent.SetOscillation -> repository.setOscillation(event.id, event.on)
            is HomeEvent.SetColorTemp -> repository.setColorTemp(event.id, event.kelvin)
            is HomeEvent.SetColor -> repository.setColor(event.id, event.rgb)
            is HomeEvent.SetFanPreset -> repository.setFanPreset(event.id, event.preset)

            is HomeEvent.ToggleLock -> repository.toggleLock(event.id)
            HomeEvent.LockAll -> repository.lockAll()

            is HomeEvent.ChooseMode -> repository.chooseMode(event.mode)
            HomeEvent.DismissSuggestion -> repository.dismissSuggestion()
            HomeEvent.AcknowledgeAlert -> repository.acknowledgeAlert()
            is HomeEvent.StepTarget -> repository.stepTarget(event.delta)

            HomeEvent.EnterEdit -> screen.update { it.copy(editMode = true, selectedId = null) }
            is HomeEvent.RemoveFavourite -> { repository.toggleFavourite(event.id); screen.update { it.copy(sizes = it.sizes - event.id, order = it.order.filter { id -> id != event.id }) } }
            HomeEvent.ExitEdit -> screen.update { it.copy(editMode = false, selectedId = null) }
            is HomeEvent.SelectCard -> screen.update { it.copy(selectedId = event.id) }
            is HomeEvent.ResizeCard -> screen.update { it.copy(sizes = if (event.size == com.alice.home.ui.components.DeviceCardSize.Small) it.sizes - event.id else it.sizes + (event.id to event.size)) }
            is HomeEvent.MoveCard -> screen.update { s ->
                val ids = repository.state.value.favourites.map { it.id }
                val cur = (s.order.filter { it in ids } + ids.filter { it !in s.order }).toMutableList()
                val i = cur.indexOf(event.id)
                if (i < 0) s else { cur.removeAt(i); cur.add((i + event.by).coerceIn(0, cur.size), event.id); s.copy(order = cur) }
            }
            HomeEvent.ResetLayout -> screen.update { it.copy(sizes = emptyMap(), order = emptyList(), toast = "Layout reset") }

            is HomeEvent.ToggleActivity -> screen.update { it.copy(activityOpen = !it.activityOpen) }
            is HomeEvent.RunScene -> screen.update { it.copy(toast = "${event.name} started") }

            HomeEvent.Refresh -> repository.refresh()
            HomeEvent.DismissToast -> screen.update { it.copy(toast = null) }
        }
    }

    /** State the screen owns. Dies with the screen; never written to the repository. */
    private data class ScreenState(
        val activityOpen: Boolean = false,
        val editMode: Boolean = false,
        val selectedId: String? = null,
        val sizes: Map<String, com.alice.home.ui.components.DeviceCardSize> = emptyMap(),
        val order: List<String> = emptyList(),
        val toast: String? = null,
    )
}
