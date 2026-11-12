package com.alice.home.ui.settings

sealed interface SettingsEvent {
    data class Focus(val key: String) : SettingsEvent
    data object BackUpNow : SettingsEvent
    data class Verify(val id: String) : SettingsEvent
    data class AskDelete(val id: String) : SettingsEvent
    data class AskRestore(val id: String) : SettingsEvent
    data class Delete(val id: String) : SettingsEvent
    data class Restore(val id: String) : SettingsEvent
    data class SetNightly(val on: Boolean) : SettingsEvent
    data class SetIncludeHa(val on: Boolean) : SettingsEvent
    data class SetKeep(val n: Int) : SettingsEvent
    data object Recheck : SettingsEvent
    data class SetAutoUpdate(val on: Boolean) : SettingsEvent
    data class AskInstall(val now: Boolean) : SettingsEvent
    data class Install(val now: Boolean) : SettingsEvent
    data object CancelSchedule : SettingsEvent
    data class SetSupportHours(val h: Int) : SettingsEvent
    data class ToggleScope(val key: String) : SettingsEvent
    data object AskGrant : SettingsEvent
    data object Grant : SettingsEvent
    data object EndSupport : SettingsEvent
    data class SetPush(val on: Boolean) : SettingsEvent
    data class SetQuiet(val on: Boolean) : SettingsEvent
    data object ConfirmYes : SettingsEvent
    data object ConfirmNo : SettingsEvent
    data object DismissToast : SettingsEvent
}
