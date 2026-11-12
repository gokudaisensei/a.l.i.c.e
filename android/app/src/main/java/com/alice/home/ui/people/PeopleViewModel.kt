package com.alice.home.ui.people

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alice.home.data.AliceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

class PeopleViewModel(private val repository: AliceRepository) : ViewModel() {

    private val screen = MutableStateFlow(PeopleUiState())

    val uiState: StateFlow<PeopleUiState> = combine(repository.state, screen) { h, s -> s.copy(household = h) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, PeopleUiState(household = repository.state.value))

    fun onEvent(event: PeopleEvent) {
        val h = repository.state.value
        val who = screen.value.selected
        when (event) {
            is PeopleEvent.Focus -> screen.update { it.copy(focus = event.key) }
            is PeopleEvent.Open -> screen.update { it.copy(selected = event.name, confirmRemove = false) }
            PeopleEvent.Close -> screen.update { it.copy(selected = null, confirmRemove = false) }
            is PeopleEvent.SetRole -> if (who != null && h.people.firstOrNull { it.name == who }?.me == false) {
                repository.setRole(who, event.role)
                toast("$who is now ${event.role.lowercase()}")
            }
            is PeopleEvent.ToggleDevice -> h.people.firstOrNull { it.name == who && it.role != "Admin" }?.let { p ->
                val cur = p.devices ?: h.devices.map { it.id }.toSet()
                repository.setDeviceAccess(p.name, if (event.id in cur) cur - event.id else cur + event.id)
            }
            is PeopleEvent.SetAllDevices -> h.people.firstOrNull { it.name == who && it.role != "Admin" }?.let { p ->
                repository.setDeviceAccess(p.name, if (event.all) h.devices.map { it.id }.toSet() else emptySet())
            }
            PeopleEvent.AskRemove -> screen.update { it.copy(confirmRemove = true) }
            PeopleEvent.CancelRemove -> screen.update { it.copy(confirmRemove = false) }
            // the passkey check itself is the backend's; with the mock, confirming is the whole step
            PeopleEvent.ConfirmRemove -> if (who != null && h.people.firstOrNull { it.name == who }?.me == false) {
                repository.removeMember(who)
                screen.update { it.copy(selected = null, confirmRemove = false, toast = "$who removed from the home") }
            }
            is PeopleEvent.SetInviteRole -> screen.update { it.copy(inviteRole = event.role, newCode = null) }
            is PeopleEvent.SetInviteHours -> screen.update { it.copy(inviteHours = event.hours, newCode = null) }
            PeopleEvent.CreateInvite -> {
                val s = screen.value
                val code = repository.createInvite(s.inviteRole, s.inviteHours)
                screen.update { it.copy(newCode = code) }
            }
            is PeopleEvent.RevokeInvite -> { repository.revokeInvite(event.id); toast("Invite revoked") }
            PeopleEvent.AddPasskey -> toast("Adding a passkey needs the live backend")
            PeopleEvent.CodeCopied -> toast("Code copied")
            PeopleEvent.DismissToast -> screen.update { it.copy(toast = null) }
        }
    }

    private fun toast(text: String) = screen.update { it.copy(toast = text) }
}
