package com.alice.home.ui.rooms

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alice.home.data.AliceRepository
import com.alice.home.domain.model.Kind
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/** The order device types appear in, most used first. */
private val TYPE_ORDER = listOf(Kind.Light, Kind.Climate, Kind.Fan, Kind.Cover, Kind.Plug, Kind.Lock, Kind.Camera, Kind.Contact)

private fun Kind.groupTitle() = when (this) {
    Kind.Light -> "Lights"; Kind.Climate -> "Climate"; Kind.Fan -> "Fans"; Kind.Cover -> "Blinds & covers"
    Kind.Plug -> "Plugs"; Kind.Lock -> "Locks"; Kind.Camera -> "Cameras"; Kind.Contact -> "Sensors"
}

class RoomsViewModel(private val repository: AliceRepository) : ViewModel() {

    private val screen = MutableStateFlow(ScreenState())

    val uiState: StateFlow<RoomsUiState> = combine(repository.state, screen) { household, s ->
        val visible = household.devices.filter { !it.hidden }
        val filtered = visible.filter { d ->
            (s.query.isBlank() || (d.name + " " + d.room + " " + d.hardware).lowercase().contains(s.query.trim().lowercase())) &&
                (!s.voiceOnly || d.voice)
        }
        val groups = when (s.groupBy) {
            GroupBy.Room -> household.devices.map { it.room }.distinct().sorted().mapNotNull { r ->
                val g = filtered.filter { it.room == r }
                if (g.isEmpty()) null else RoomGroup(r, "${g.count { it.on }} of ${g.size} active", g)
            }
            GroupBy.Type -> TYPE_ORDER.mapNotNull { kind ->
                val g = filtered.filter { it.kind == kind }
                if (g.isEmpty()) null else RoomGroup(
                    title = kind.groupTitle(), subtitle = "${g.count { it.on }} of ${g.size} active", devices = g,
                    sections = if (s.nestByBrand) g.groupBy { it.hardware.ifBlank { "Other" } }.map { (b, d) -> RoomSection(b, d) }.sortedBy { it.title } else null,
                )
            }
        }
        RoomsUiState(
            household = household, query = s.query, groupBy = s.groupBy, nestByBrand = s.nestByBrand, voiceOnly = s.voiceOnly,
            searchOpen = s.searchOpen, viewOpen = s.viewOpen, focus = s.focus, toast = s.toast, groups = groups,
            hidden = household.devices.filter { it.hidden }, roomCount = household.devices.map { it.room }.distinct().size,
            totalCount = visible.size, voiceCount = visible.count { it.voice },
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = RoomsUiState(household = repository.state.value),
    )

    fun onEvent(event: RoomsEvent) {
        when (event) {
            is RoomsEvent.SetQuery -> screen.update { it.copy(query = event.query) }
            // a new grouping starts over: only its first group is open, until the person scrolls or taps
            is RoomsEvent.SetGroupBy -> screen.update { it.copy(groupBy = event.groupBy, focus = null, nestByBrand = it.nestByBrand && event.groupBy == GroupBy.Type) }
            RoomsEvent.ToggleNestByBrand -> screen.update { it.copy(nestByBrand = !it.nestByBrand) }
            RoomsEvent.ToggleVoiceOnly -> screen.update { it.copy(voiceOnly = !it.voiceOnly, focus = null) }
            // closing the search also clears it: a hidden filter must never keep narrowing the list
            RoomsEvent.ToggleSearch -> screen.update { it.copy(searchOpen = !it.searchOpen, query = if (it.searchOpen) "" else it.query, focus = null) }
            RoomsEvent.ToggleView -> screen.update { it.copy(viewOpen = !it.viewOpen) }
            RoomsEvent.ClearFilters -> screen.update { it.copy(query = "", voiceOnly = false, focus = null) }
            is RoomsEvent.Focus -> screen.update { it.copy(focus = event.key) }

            is RoomsEvent.ToggleDevice -> repository.toggleDevice(event.id)
            is RoomsEvent.CommitLevel -> repository.commitLevel(event.id, event.level)
            is RoomsEvent.ToggleFavourite -> repository.toggleFavourite(event.id)
            is RoomsEvent.ToggleVoice -> repository.toggleVoice(event.id)
            is RoomsEvent.SetHidden -> repository.setHidden(event.id, event.hidden)

            is RoomsEvent.SetHvacMode -> repository.setHvacMode(event.id, event.mode)
            is RoomsEvent.SetOscillation -> repository.setOscillation(event.id, event.on)
            is RoomsEvent.SetColorTemp -> repository.setColorTemp(event.id, event.kelvin)
            is RoomsEvent.SetColor -> repository.setColor(event.id, event.rgb)
            is RoomsEvent.SetFanPreset -> repository.setFanPreset(event.id, event.preset)

            RoomsEvent.Refresh -> repository.refresh()
            RoomsEvent.DismissToast -> screen.update { it.copy(toast = null) }
        }
    }

    private data class ScreenState(
        val query: String = "",
        val groupBy: GroupBy = GroupBy.Room,
        val nestByBrand: Boolean = false,
        val voiceOnly: Boolean = false,
        val searchOpen: Boolean = false,
        val viewOpen: Boolean = false,
        val focus: String? = null,
        val toast: String? = null,
    )
}
