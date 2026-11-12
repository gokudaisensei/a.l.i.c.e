package com.alice.home.ui.people

sealed interface PeopleEvent {
    data class Focus(val key: String) : PeopleEvent
    data class Open(val name: String) : PeopleEvent
    data object Close : PeopleEvent
    data class SetRole(val role: String) : PeopleEvent
    data class ToggleDevice(val id: String) : PeopleEvent
    data class SetAllDevices(val all: Boolean) : PeopleEvent
    data object AskRemove : PeopleEvent
    data object CancelRemove : PeopleEvent
    data object ConfirmRemove : PeopleEvent
    data class SetInviteRole(val role: String) : PeopleEvent
    data class SetInviteHours(val hours: Int) : PeopleEvent
    data object CreateInvite : PeopleEvent
    data class RevokeInvite(val id: String) : PeopleEvent
    data object AddPasskey : PeopleEvent
    data object CodeCopied : PeopleEvent
    data object DismissToast : PeopleEvent
}
