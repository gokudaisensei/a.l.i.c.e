package com.alice.home.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Backup
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.MonitorHeart
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Science
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.SupportAgent
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alice.home.data.mock.MockAliceRepository
import com.alice.home.di.AppGraph
import com.alice.home.domain.model.Backup
import com.alice.home.domain.model.Health
import com.alice.home.domain.model.tod
import com.alice.home.ui.Haptic
import com.alice.home.ui.components.AccordionList
import com.alice.home.ui.components.AccordionPane
import com.alice.home.ui.components.AliceWordmark
import com.alice.home.ui.components.GlassToast
import com.alice.home.ui.components.IconButtonCircle
import com.alice.home.ui.components.IconChip
import com.alice.home.ui.components.Peek
import com.alice.home.ui.components.PeekStack
import com.alice.home.ui.components.PillButton
import com.alice.home.ui.components.PresetChip
import com.alice.home.ui.components.Pressable
import com.alice.home.ui.components.Segmented
import com.alice.home.ui.components.Tile
import com.alice.home.ui.components.Toggle
import com.alice.home.ui.components.ValueStepper
import com.alice.home.ui.components.hero
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * Settings is not a tab. It is the **blind behind the sky**: tap the gear at the top right of any screen and it fades in over the page
 * (and a drag up on it, or Back, lets it go again), so the bottom bar stays about the home and Settings is about the house. Inside it
 * is a catalogue screen (design-bible §12) with the same accordion as the others: Backups, Health, Updates, Support access, Your alerts.
 * The hero is a verdict ("everything is working" or what needs a look). Anything that changes what the house keeps or who gets in asks
 * for the passkey first, in one card at the bottom.
 */
@Composable
fun SettingsSheet(
    progress: Float,
    onClose: () -> Unit,
    vm: SettingsViewModel = viewModel { SettingsViewModel(AppGraph.repository) },
) {
    if (progress <= 0f) return
    val state by vm.uiState.collectAsStateWithLifecycle()
    BackHandler(enabled = progress > 0.5f, onBack = onClose)
    // A plain fade: the page stays where it is and Settings fades over it.
    SettingsContent(state, vm::onEvent, onClose, Modifier.graphicsLayer { alpha = progress })
}

@Composable
internal fun SettingsContent(state: SettingsUiState, onEvent: (SettingsEvent) -> Unit, onClose: () -> Unit = {}, modifier: Modifier = Modifier) {
    val c = Alice.c
    val a = state.household.admin
    Box(modifier.fillMaxSize().background(c.bg)) {
        Column(Modifier.fillMaxSize()) {
            SettingsHero(state, onClose)
            AccordionList(panes(state, onEvent), state.focus, { onEvent(SettingsEvent.Focus(it)) }, Modifier.weight(1f).padding(top = 4.dp), bottomInset = if (state.confirm != null) 220.dp else 40.dp)
        }
        state.confirm?.let { PasskeyCard(it, onEvent, Modifier.align(Alignment.BottomCenter)) }
        GlassToast(state.toast, { onEvent(SettingsEvent.DismissToast) }, Modifier.align(Alignment.BottomCenter).padding(bottom = if (state.confirm != null) 230.dp else 40.dp).navigationBarsPadding())
    }
}

@Composable
private fun SettingsHero(state: SettingsUiState, onClose: () -> Unit) {
    val c = Alice.c
    val a = state.household.admin
    val (heroA, heroB, ink, chip) = hero(tod(), c.dark)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp)).background(Brush.verticalGradient(listOf(heroA, heroB)))
            .pointerInput(Unit) {
                var drag = 0f
                detectVerticalDragGestures(onDragStart = { drag = 0f }, onVerticalDrag = { _, d -> drag += d }, onDragEnd = { if (drag < -60.dp.toPx()) onClose() })
            }
            .statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 22.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            AliceWordmark(Modifier.weight(1f), size = 30.sp, color = ink)
            IconButtonCircle(Icons.Rounded.Close, onClose, size = 44.dp, haptic = Haptic.Light, contentDescription = "Close settings", bg = chip, tint = ink)
        }
        Text("Settings", style = AliceType.hero, color = ink)
        Text(if (a.problems == 0) "Everything is working" else "${a.problems} ${if (a.problems == 1) "thing needs" else "things need"} a look", style = AliceType.heroSub, color = ink.copy(alpha = 0.92f))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconChip(Icons.Rounded.Backup, if (a.backupVerified) "Backup verified" else "Backup not verified", ink, chip)
            IconChip(Icons.Rounded.SystemUpdate, a.update.available?.let { "$it ready" } ?: "v${a.update.current}", ink, chip)
            if (a.support.endsIn != null) IconChip(Icons.Rounded.SupportAgent, "Support in", ink, chip)
        }
    }
}

private fun panes(state: SettingsUiState, onEvent: (SettingsEvent) -> Unit): List<AccordionPane> {
    val a = state.household.admin
    fun peek(i: androidx.compose.ui.graphics.vector.ImageVector): @Composable () -> Unit = { PeekStack(listOf(Peek(icon = i))) }
    return listOf(
        AccordionPane("backups", "Backups", if (a.backupVerified) "Verified" else "Not verified", peek(Icons.Rounded.Backup)) { BackupsBody(state, onEvent) },
        AccordionPane("health", "Health", if (a.checks.all { it.status == Health.Ok }) "All working" else "${a.checks.count { it.status != Health.Ok }} need a look", peek(Icons.Rounded.MonitorHeart)) { HealthBody(state, onEvent) },
        AccordionPane("updates", "Updates", a.update.available?.let { "$it ready" } ?: "Up to date", peek(Icons.Rounded.SystemUpdate)) { UpdatesBody(state, onEvent) },
        AccordionPane("support", "Support access", if (a.support.endsIn != null) "Open, ${a.support.endsIn}" else "Closed", peek(Icons.Rounded.SupportAgent)) { SupportBody(state, onEvent) },
        AccordionPane("alerts", "Your alerts", if (a.prefs.push) "On" else "Off", peek(Icons.Rounded.Notifications)) { AlertsBody(state, onEvent) },
    )
}

@Composable
private fun Body(content: @Composable () -> Unit) = Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }

@Composable
private fun Setting(label: String, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = AliceType.body, color = Alice.c.ink)
        content()
    }
}

@Composable
private fun Mono(text: String) = Text(text.uppercase(), style = AliceType.mono.copy(fontSize = 10.5.sp), color = Alice.c.ink3)

private val pad = PaddingValues(horizontal = 16.dp, vertical = 12.dp)

@Composable
private fun BackupsBody(state: SettingsUiState, onEvent: (SettingsEvent) -> Unit) {
    val c = Alice.c
    val a = state.household.admin
    val latest = a.latestBackup
    Body {
        Text(
            when { latest == null -> "There is no backup yet."; latest.verified == true -> "Your last backup works."; latest.verified == false -> "The newest backup failed its test." else -> "The newest backup is untested." },
            style = AliceType.bodyStrong.copy(fontSize = 18.sp), color = c.ink,
        )
        Text("A backup only counts as verified after Alice opens it and checks it.", style = AliceType.small, color = c.ink2)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PillButton("Back up now", { onEvent(SettingsEvent.BackUpNow) }, icon = Icons.Rounded.Backup, haptic = Haptic.Medium, padding = pad)
            if (latest != null) PillButton("Run restore test", { onEvent(SettingsEvent.Verify(latest.id)) }, color = c.tile2, ink = c.ink, icon = Icons.Rounded.Science, padding = pad)
        }
        Setting("Nightly backup") { Toggle(a.backupSettings.nightly, { onEvent(SettingsEvent.SetNightly(it)) }) }
        Setting("Home Assistant too") { Toggle(a.backupSettings.includeHa, { onEvent(SettingsEvent.SetIncludeHa(it)) }) }
        Setting("Keeps") { ValueStepper(a.backupSettings.keep, { onEvent(SettingsEvent.SetKeep(it)) }, 1..90, "backups") }
        Mono("Recent backups")
        a.backups.forEach { BackupRow(it, onEvent) }
    }
}

@Composable
private fun BackupRow(b: Backup, onEvent: (SettingsEvent) -> Unit) {
    val c = Alice.c
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.tile2)) {
        Pressable(Modifier.fillMaxWidth(), color = Color.Transparent, depth = 0.985f, haptic = Haptic.Light, onClick = { open = !open }) {
            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(b.when_, style = AliceType.bodyStrong, color = c.ink)
                Text(
                    "${b.kind} · ${b.where_} · ${b.size} · " + when { !b.ok -> "Failed"; b.verified == true -> "Verified"; b.verified == false -> "Failed its test"; else -> "Not tested" },
                    style = AliceType.mono.copy(fontSize = 10.5.sp), color = if (!b.ok || b.verified == false) c.crit else c.ink3,
                )
            }
        }
        if (open) Row(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (b.ok) PillButton("Test", { onEvent(SettingsEvent.Verify(b.id)) }, color = c.tile, ink = c.ink)
            if (b.ok) PillButton("Restore", { onEvent(SettingsEvent.AskRestore(b.id)) }, color = c.tile, ink = c.ink)
            PillButton("Delete", { onEvent(SettingsEvent.AskDelete(b.id)) }, color = c.crit.copy(alpha = 0.16f), ink = c.crit)
        }
    }
}

@Composable
private fun HealthBody(state: SettingsUiState, onEvent: (SettingsEvent) -> Unit) {
    val c = Alice.c
    val a = state.household.admin
    Body {
        a.checks.forEach { h ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(if (h.status == Health.Ok) c.sage else c.crit))
                Column(Modifier.weight(1f)) {
                    Text(h.label, style = AliceType.bodyStrong, color = c.ink)
                    Text(h.detail, style = AliceType.small, color = c.ink2)
                }
                // the state is the word as well as the dot, never colour alone
                Text(when (h.status) { Health.Ok -> "Working"; Health.Warn -> "Needs a look"; Health.Down -> "Down" }, style = AliceType.label, color = if (h.status == Health.Ok) c.sage else c.crit)
            }
        }
        Text("Alice ${a.update.current} · ${a.uptime}", style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink3)
        PillButton("Check again", { onEvent(SettingsEvent.Recheck) }, color = c.tile2, ink = c.ink, padding = pad)
    }
}

@Composable
private fun UpdatesBody(state: SettingsUiState, onEvent: (SettingsEvent) -> Unit) {
    val c = Alice.c
    val u = state.household.admin.update
    Body {
        Mono("Installed")
        Text(u.current, style = AliceType.big, color = c.ink)
        Setting("Automatic updates") { Toggle(u.autoUpdate, { onEvent(SettingsEvent.SetAutoUpdate(it)) }) }
        Text("Window ${u.window}. Applied by the host updater, not this app.", style = AliceType.small, color = c.ink2)
        if (u.available == null) Text("You are up to date. Alice checks for new versions every few hours.", style = AliceType.body, color = c.ink)
        else {
            Mono("Version ${u.available} is ready")
            u.notes.forEach { Text("· $it", style = AliceType.body, color = c.ink) }
            Text(if (u.signed) "Signature verified." else "Not signed: Alice will not install it.", style = AliceType.small, color = if (u.signed) c.sage else c.crit)
            if (u.scheduled) {
                Text("Scheduled for the next window, after the backups.", style = AliceType.bodyStrong, color = c.ink)
                PillButton("Cancel schedule", { onEvent(SettingsEvent.CancelSchedule) }, color = c.tile2, ink = c.ink, padding = pad)
            } else if (u.signed) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton("Install in the next window", { onEvent(SettingsEvent.AskInstall(false)) }, icon = Icons.Rounded.Fingerprint, padding = pad)
                PillButton("Now", { onEvent(SettingsEvent.AskInstall(true)) }, color = c.tile2, ink = c.ink, padding = pad)
            }
        }
        state.household.admin.pastUpdates.let { past ->
            if (past.isNotEmpty()) {
                Mono("Past updates")
                past.forEach { Text("${it.from} to ${it.to} · ${it.how} · ${if (it.ok) "done" else "failed"} · ${it.when_}", style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink3) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SupportBody(state: SettingsUiState, onEvent: (SettingsEvent) -> Unit) {
    val c = Alice.c
    val s = state.household.admin.support
    Body {
        if (s.endsIn != null) {
            Text("Support has access, and it ends on its own in ${s.endsIn}.", style = AliceType.bodyStrong, color = c.ink)
            Text("Can see: ${s.scope.joinToString(", ") { scopeLabel(it).lowercase() }}. It can never unlock a door.", style = AliceType.small, color = c.ink2)
            PillButton("End access now", { onEvent(SettingsEvent.EndSupport) }, padding = pad)
        } else {
            Text("No one has access right now. Support only comes in when you let them, for a set time.", style = AliceType.body, color = c.ink2)
            Segmented(listOf(1, 4, 24).map { it.toString() to "$it hour${if (it > 1) "s" else ""}" }, state.supportHours.toString(), { onEvent(SettingsEvent.SetSupportHours(it.toInt())) })
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("health", "devices", "cameras", "controls").forEach { k -> PresetChip(scopeLabel(k), k in state.supportScope, { onEvent(SettingsEvent.ToggleScope(k)) }) }
            }
            PillButton("Grant access with passkey", { onEvent(SettingsEvent.AskGrant) }, icon = Icons.Rounded.Fingerprint, padding = pad)
        }
        Text("Support can read, never act, and every grant ends by itself. Support's own sign-in is not set up yet, so nothing can connect today.", style = AliceType.small, color = c.ink3)
    }
}

private fun scopeLabel(k: String) = when (k) { "health" -> "System health"; "devices" -> "Device list"; "cameras" -> "Camera views"; else -> "Controls" }

@Composable
private fun AlertsBody(state: SettingsUiState, onEvent: (SettingsEvent) -> Unit) {
    val c = Alice.c
    val p = state.household.admin.prefs
    Body {
        Setting("Push alerts on this phone") { Toggle(p.push, { onEvent(SettingsEvent.SetPush(it)) }) }
        Setting("Quiet hours") { Toggle(p.quiet, { onEvent(SettingsEvent.SetQuiet(it)) }) }
        if (p.quiet) Text("No alerts from ${p.quietFrom} to ${p.quietTo}, except doors left open.", style = AliceType.small, color = c.ink2)
        Text("These are your own. Each person sets theirs.", style = AliceType.small, color = c.ink3)
    }
}

/** The one place a passkey is asked for in Settings: what will happen, then Confirm or Cancel, within thumb reach. */
@Composable
private fun PasskeyCard(c: Confirm, onEvent: (SettingsEvent) -> Unit, modifier: Modifier) {
    val col = Alice.c
    Column(
        modifier.fillMaxWidth().padding(12.dp).navigationBarsPadding().clip(RoundedCornerShape(28.dp)).background(col.tile).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            androidx.compose.material3.Icon(Icons.Rounded.Shield, null, tint = col.sage)
            Text(c.title, style = AliceType.bodyStrong.copy(fontSize = 17.sp), color = col.ink)
        }
        Text(c.body, style = AliceType.small, color = col.ink2)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PillButton("Confirm with passkey", { onEvent(SettingsEvent.ConfirmYes) }, icon = Icons.Rounded.Fingerprint, haptic = Haptic.Warning, padding = pad)
            PillButton("Cancel", { onEvent(SettingsEvent.ConfirmNo) }, color = col.tile2, ink = col.ink, padding = pad)
        }
    }
}

@Preview(showBackground = true, widthDp = 412, heightDp = 915)
@Composable
private fun SettingsContentPreview() {
    com.alice.home.ui.theme.AliceTheme {
        SettingsContent(SettingsUiState(household = MockAliceRepository().state.value), {})
    }
}
