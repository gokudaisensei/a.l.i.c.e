package com.alice.home.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alice.home.data.AliceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

class SettingsViewModel(private val repository: AliceRepository) : ViewModel() {

    private val screen = MutableStateFlow(SettingsUiState())

    val uiState: StateFlow<SettingsUiState> = combine(repository.state, screen) { h, s -> s.copy(household = h) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, SettingsUiState(household = repository.state.value))

    fun onEvent(e: SettingsEvent) {
        val a = repository.state.value.admin
        when (e) {
            is SettingsEvent.Focus -> screen.update { it.copy(focus = e.key) }
            SettingsEvent.BackUpNow -> { repository.backUpNow(); toast("Backing up") }
            is SettingsEvent.Verify -> { repository.verifyBackup(e.id); toast("Restore test passed") }
            is SettingsEvent.AskDelete -> ask("Delete this backup?", "The file is deleted from where it is kept.", SettingsEvent.Delete(e.id))
            is SettingsEvent.AskRestore -> ask("Restore this backup?", "Everything since is replaced. Your current data is kept beside it.", SettingsEvent.Restore(e.id))
            is SettingsEvent.Delete -> { repository.deleteBackup(e.id); toast("Backup deleted") }
            is SettingsEvent.Restore -> { repository.restoreBackup(e.id); toast("Restoring starts on the live backend") }
            is SettingsEvent.SetNightly -> repository.setBackupSettings(a.backupSettings.copy(nightly = e.on))
            is SettingsEvent.SetIncludeHa -> repository.setBackupSettings(a.backupSettings.copy(includeHa = e.on))
            is SettingsEvent.SetKeep -> repository.setBackupSettings(a.backupSettings.copy(keep = e.n.coerceIn(1, 90)))
            SettingsEvent.Recheck -> { repository.recheckHealth(); toast("Checked just now") }
            is SettingsEvent.SetAutoUpdate -> { repository.setAutoUpdate(e.on); toast(if (e.on) "Updates install by themselves in the window" else "Automatic updates are off") }
            is SettingsEvent.AskInstall -> ask(
                if (e.now) "Install ${a.update.available} now?" else "Install ${a.update.available} in the next window?",
                if (e.now) "Alice backs up first, then restarts. It is back in a few minutes." else "It installs after the nightly backups, ${a.update.window}.",
                SettingsEvent.Install(e.now),
            )
            is SettingsEvent.Install -> { repository.installUpdate(e.now); toast(if (e.now) "Updated" else "Scheduled for the next window") }
            SettingsEvent.CancelSchedule -> { repository.cancelUpdateSchedule(); toast("Schedule cancelled") }
            is SettingsEvent.SetSupportHours -> screen.update { it.copy(supportHours = e.h) }
            is SettingsEvent.ToggleScope -> screen.update { it.copy(supportScope = if (e.key in it.supportScope) it.supportScope - e.key else it.supportScope + e.key) }
            SettingsEvent.AskGrant -> if (screen.value.supportScope.isEmpty()) toast("Choose what support may see") else
                ask("Let support in?", "Access lasts ${screen.value.supportHours} hours and ends on its own. Support can never unlock a door.", SettingsEvent.Grant)
            SettingsEvent.Grant -> { repository.grantSupport(screen.value.supportHours, screen.value.supportScope); toast("Support has access") }
            SettingsEvent.EndSupport -> { repository.endSupport(); toast("Support access ended") }
            is SettingsEvent.SetPush -> repository.setPrefs(a.prefs.copy(push = e.on))
            is SettingsEvent.SetQuiet -> repository.setPrefs(a.prefs.copy(quiet = e.on))
            // the passkey check itself is the backend's; with the mock, confirming is the whole step
            SettingsEvent.ConfirmYes -> screen.value.confirm?.let { c -> screen.update { it.copy(confirm = null) }; onEvent(c.then) }
            SettingsEvent.ConfirmNo -> screen.update { it.copy(confirm = null) }
            SettingsEvent.DismissToast -> screen.update { it.copy(toast = null) }
        }
    }

    private fun ask(title: String, body: String, then: SettingsEvent) = screen.update { it.copy(confirm = Confirm(title, body, then)) }
    private fun toast(t: String) = screen.update { it.copy(toast = t) }
}
