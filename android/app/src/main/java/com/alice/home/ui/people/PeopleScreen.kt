package com.alice.home.ui.people

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alice.home.data.mock.MockAliceRepository
import com.alice.home.di.AppGraph
import com.alice.home.domain.model.Invite
import com.alice.home.domain.model.Person
import com.alice.home.domain.model.tod
import com.alice.home.ui.Haptic
import com.alice.home.ui.LocalHaptics
import com.alice.home.ui.components.AccordionList
import com.alice.home.ui.components.AccordionPane
import com.alice.home.ui.components.AliceWordmark
import com.alice.home.ui.components.GlassTabBar
import com.alice.home.ui.components.GlassToast
import com.alice.home.ui.components.IconButtonCircle
import com.alice.home.ui.components.IconChip
import com.alice.home.ui.components.IconDisc
import com.alice.home.ui.components.Peek
import com.alice.home.ui.components.PeekStack
import com.alice.home.ui.components.PillButton
import com.alice.home.ui.components.Pressable
import com.alice.home.ui.components.Segmented
import com.alice.home.ui.components.Tile
import com.alice.home.ui.components.hero
import com.alice.home.ui.components.recordBackdrop
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * People is a catalogue screen (design-bible §12) with one idea of its own: **a person is a card of what they may do**. The list shows
 * the household, who is home, and each role in a word. Open someone and the hero becomes their card; the panel says in plain words
 * what their role lets them do, and changing the role rewrites that sentence. Removing someone asks for a passkey first. Inviting is a
 * one-time code, shown once, with the people waiting to use one beneath it. Alice has no passwords, so Sign-in is a single note.
 */
@Composable
fun PeopleScreen(
    tab: Int = 3,
    onTab: (Int) -> Unit = {},
    backdrop: GraphicsLayer = rememberGraphicsLayer(),
    onMinimizedChange: (Boolean) -> Unit = {},
    onNestedChange: (Boolean) -> Unit = {},
    vm: PeopleViewModel = viewModel { PeopleViewModel(AppGraph.repository) },
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    PeopleContent(state = state, onEvent = vm::onEvent, tab = tab, onTab = onTab, backdrop = backdrop, onMinimizedChange = onMinimizedChange, onNestedChange = onNestedChange)
}

internal fun roleBlurb(role: String) = when (role) {
    "Admin" -> "Everything: devices, automations, people, backups and updates."
    "Member" -> "Controls every device and builds automations. Cannot manage people or backups."
    else -> "Only the devices they are given. Never energy use or activity history."
}

@Composable
internal fun PeopleContent(state: PeopleUiState, onEvent: (PeopleEvent) -> Unit, tab: Int = 3, onTab: (Int) -> Unit = {}, backdrop: GraphicsLayer = rememberGraphicsLayer(), onMinimizedChange: (Boolean) -> Unit = {}, onNestedChange: (Boolean) -> Unit = {}) {
    val c = Alice.c
    val h = state.household
    val haptics = LocalHaptics.current
    val person = state.selected?.let { n -> h.people.firstOrNull { it.name == n } }
    LaunchedEffect(person != null) { onNestedChange(person != null) }
    val barInset = 104.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    BackHandler(enabled = person != null) { onEvent(PeopleEvent.Close) }

    Box(Modifier.fillMaxSize().background(c.bg)) {
        Box(Modifier.fillMaxSize().recordBackdrop(backdrop)) {
            Column(Modifier.fillMaxSize()) {
                PeopleHero(state, person, onEvent)
                if (person == null) {
                    AccordionList(panes(state, onEvent), state.focus, { onEvent(PeopleEvent.Focus(it)) }, Modifier.weight(1f).padding(top = 4.dp), bottomInset = barInset)
                } else {
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        MemberPanel(person, state.confirmRemove, onEvent)
                        DevicePanel(person, h.devices, onEvent)
                        Spacer(Modifier.height(120.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()))
                    }
                }
            }
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(130.dp).background(Brush.verticalGradient(0f to Color.Transparent, 0.7f to c.bg)))
        }
        AnimatedVisibility(person != null, Modifier.align(Alignment.BottomCenter), enter = slideInVertically(tween(260)) { it } + fadeIn(), exit = slideOutVertically(tween(200)) { it } + fadeOut(tween(120))) {
            if (person != null) MemberBar(person, state.confirmRemove, onEvent)
        }
        GlassToast(state.toast, { onEvent(PeopleEvent.DismissToast) }, Modifier.align(Alignment.BottomCenter).padding(bottom = if (person == null) 104.dp else 96.dp).navigationBarsPadding())
    }
}

@Composable
private fun Avatar(p: Person, size: Dp, ring: Color, fill: Color, ink: Color) {
    Box(Modifier.size(size)) {
        Box(Modifier.size(size).clip(CircleShape).background(fill), contentAlignment = Alignment.Center) {
            Text(p.name.take(1).uppercase(), style = AliceType.bodyStrong.copy(fontSize = (size.value * 0.42f).sp), color = ink)
        }
        // presence is a dot AND the row's words ("Home" / "Away"), never colour alone
        if (p.home) Box(Modifier.align(Alignment.BottomEnd).size(size * 0.3f).clip(CircleShape).background(ring).padding(2.dp).clip(CircleShape).background(Alice.c.sage))
    }
}

@Composable
private fun PeopleHero(state: PeopleUiState, person: Person?, onEvent: (PeopleEvent) -> Unit) {
    val c = Alice.c
    val h = state.household
    val (heroA, heroB, ink, chip) = hero(tod(), c.dark)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp)).background(Brush.verticalGradient(listOf(heroA, heroB)))
            .statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 22.dp).animateContentSize(tween(260)),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            AliceWordmark(Modifier.weight(1f), size = 30.sp, color = ink)
            if (person != null) IconButtonCircle(Icons.Rounded.Close, { onEvent(PeopleEvent.Close) }, size = 44.dp, haptic = Haptic.Light, contentDescription = "Back to the household", bg = chip, tint = ink)
            else com.alice.home.ui.components.SettingsButton(ink, chip)
        }
        AnimatedContent(person?.name, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(120)) }, label = "hero") { name ->
            val p = name?.let { n -> h.people.firstOrNull { it.name == n } }
            if (p == null) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("People", style = AliceType.hero, color = ink)
                    Text("${h.homeCount} of ${h.people.size} at home", style = AliceType.heroSub, color = ink.copy(alpha = 0.92f))
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        IconChip(Icons.Rounded.Group, "${h.people.size} people", ink, chip)
                        IconChip(Icons.Rounded.Fingerprint, "Passkeys only", ink, chip)
                        if (h.invites.isNotEmpty()) IconChip(Icons.Rounded.PersonAdd, "${h.invites.size} invited", ink, chip)
                    }
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Avatar(p, 72.dp, heroB, chip, ink)
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(p.name, style = AliceType.hero, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${if (p.home) "Home" else "Away"} · ${p.role}${if (p.me) " · you" else ""}", style = AliceType.heroSub, color = ink.copy(alpha = 0.92f))
                    }
                }
            }
        }
    }
}

private fun panes(state: PeopleUiState, onEvent: (PeopleEvent) -> Unit): List<AccordionPane> {
    val h = state.household
    return listOf(
        AccordionPane("household", "Household", "${h.homeCount} of ${h.people.size} home", { PeekStack(h.people.map { Peek(letter = it.name.take(1).uppercase()) }) }) {
            Column {
                h.people.forEachIndexed { i, p ->
                    if (i > 0) Box(Modifier.padding(start = 66.dp).fillMaxWidth().height(1.dp).background(Alice.c.line))
                    MemberRow(p) { onEvent(PeopleEvent.Open(p.name)) }
                }
            }
        },
        AccordionPane("invite", "Invite someone", if (h.invites.isEmpty()) "One-time code" else "${h.invites.size} waiting", { PeekStack(listOf(Peek(icon = Icons.Rounded.PersonAdd))) }) {
            InvitePanel(state, onEvent)
        },
        AccordionPane("signin", "Sign-in", "Passkeys only", { PeekStack(listOf(Peek(icon = Icons.Rounded.Fingerprint))) }) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("There are no passwords to leak or reset. Each person signs in with a passkey on their own phone.", style = AliceType.body, color = Alice.c.ink2)
                PillButton("Add a passkey on this phone", { onEvent(PeopleEvent.AddPasskey) }, icon = Icons.Rounded.Fingerprint, padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 12.dp))
            }
        },
    )
}

@Composable
private fun MemberRow(p: Person, onOpen: () -> Unit) {
    val c = Alice.c
    Pressable(Modifier.fillMaxWidth(), color = Color.Transparent, depth = 0.985f, haptic = Haptic.Light, onClick = onOpen) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(p, 40.dp, c.tile, c.glowSoft, c.glowInk)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(p.name + if (p.me) " (you)" else "", style = AliceType.bodyStrong, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${if (p.home) "Home" else "Away"} · " + (p.endsAt?.let { "ends $it" } ?: "Passkey sign-in"),
                    style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink3, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
            RolePill(p.role)
        }
    }
}

@Composable
private fun RolePill(role: String) {
    val c = Alice.c
    Text(role, Modifier.clip(CircleShape).background(if (role == "Admin") c.sageSoft else c.tile2).padding(horizontal = 12.dp, vertical = 6.dp), style = AliceType.label, color = if (role == "Admin") c.sage else c.ink2)
}

@Composable
private fun InvitePanel(state: PeopleUiState, onEvent: (PeopleEvent) -> Unit) {
    val c = Alice.c
    val clipboard = LocalClipboardManager.current
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Segmented(listOf("Member" to "Member", "Guest" to "Guest"), state.inviteRole, { onEvent(PeopleEvent.SetInviteRole(it)) })
        Text(roleBlurb(state.inviteRole), style = AliceType.small, color = c.ink2)
        Segmented(listOf("1" to "1 hour", "24" to "24 hours", "168" to "7 days"), state.inviteHours.toString(), { onEvent(PeopleEvent.SetInviteHours(it.toInt())) })
        val code = state.newCode
        if (code == null) {
            PillButton("Create one-time code", { onEvent(PeopleEvent.CreateInvite) }, icon = Icons.Rounded.PersonAdd, haptic = Haptic.Medium, padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 12.dp))
        } else {
            Tile(color = c.tile2, padding = 14.dp) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(code, style = AliceType.mono.copy(fontSize = 26.sp), color = c.ink)
                    Text("Works once. They choose a passkey when they use it. This code is shown only now.", style = AliceType.small, color = c.ink2)
                    PillButton("Copy", { clipboard.setText(AnnotatedString(code)); onEvent(PeopleEvent.CodeCopied) }, color = c.sageSoft, ink = c.sage, icon = Icons.Rounded.ContentCopy)
                }
            }
        }
        state.household.invites.forEach { InviteRow(it) { onEvent(PeopleEvent.RevokeInvite(it.id)) } }
    }
}

@Composable
private fun InviteRow(i: Invite, onRevoke: () -> Unit) {
    val c = Alice.c
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        IconDisc(Icons.Rounded.PersonAdd, c.tile2, c.ink3, size = 36.dp)
        Column(Modifier.weight(1f)) {
            Text("Waiting to be used", style = AliceType.bodyStrong, color = c.ink)
            Text("${i.role} · expires ${i.expires}", style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink3)
        }
        PillButton("Revoke", onRevoke, color = c.tile2, ink = c.ink)
    }
}

/** Which devices a person may use, grouped by room. Admins have all, so their list is a note; for everyone else each device is a switch. */
@Composable
private fun DevicePanel(p: Person, devices: List<com.alice.home.domain.model.Device>, onEvent: (PeopleEvent) -> Unit) {
    val c = Alice.c
    val shown = devices.filter { !it.hidden }
    val allowed = p.devices ?: shown.map { it.id }.toSet()
    Tile(color = c.tile, padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("DEVICES", style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink3)
                    Text(if (p.role == "Admin") "All ${shown.size} devices" else "${shown.count { it.id in allowed }} of ${shown.size} devices", style = AliceType.bodyStrong, color = c.ink)
                }
                if (p.role != "Admin") {
                    PillButton("All", { onEvent(PeopleEvent.SetAllDevices(true)) }, color = c.tile2, ink = c.ink)
                    Spacer(Modifier.size(8.dp))
                    PillButton("None", { onEvent(PeopleEvent.SetAllDevices(false)) }, color = c.tile2, ink = c.ink)
                }
            }
            if (p.role == "Admin") Text("Admins can use every device. Change the role to limit them.", style = AliceType.small, color = c.ink2)
            else shown.groupBy { it.room }.forEach { (room, list) ->
                Text(room.uppercase(), Modifier.padding(top = 6.dp), style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink3)
                list.forEach { d ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(d.name, Modifier.weight(1f), style = AliceType.body, color = c.ink, maxLines = 2)
                        com.alice.home.ui.components.Toggle(d.id in allowed, { onEvent(PeopleEvent.ToggleDevice(d.id)) })
                    }
                }
            }
        }
    }
}

/** What a member can do, in words, and the role to change it with. You cannot change your own role: someone else must. */
@Composable
private fun MemberPanel(p: Person, confirming: Boolean, onEvent: (PeopleEvent) -> Unit) {
    val c = Alice.c
    Tile(color = c.tile, padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("ROLE", style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink3)
            if (p.me) Text("You are ${p.role.lowercase()}. Another admin can change that.", style = AliceType.small, color = c.ink2)
            else Segmented(listOf("Admin" to "Admin", "Member" to "Member", "Guest" to "Guest"), p.role, { onEvent(PeopleEvent.SetRole(it)) })
            Text(roleBlurb(p.role), style = AliceType.body, color = c.ink)
            p.endsAt?.let { Text("Guest access ends $it.", style = AliceType.small, color = c.ink2) }
        }
    }
    if (confirming) Tile(color = c.crit.copy(alpha = 0.12f), padding = 16.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Shield, null, tint = c.crit)
            Text("Remove ${p.name}? They lose access straight away and their passkeys stop working here. This asks for your passkey.", style = AliceType.small, color = c.ink)
        }
    }
}

@Composable
private fun MemberBar(p: Person, confirming: Boolean, onEvent: (PeopleEvent) -> Unit) {
    val c = Alice.c
    Row(
        Modifier.fillMaxWidth().background(Brush.verticalGradient(0f to Color.Transparent, 0.35f to c.bg)).navigationBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 30.dp, bottom = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        if (confirming) {
            Bar("Confirm with passkey", Icons.Rounded.Fingerprint, c.crit, c.onSage, Modifier.weight(1f), Haptic.Warning) { onEvent(PeopleEvent.ConfirmRemove) }
            Bar("Cancel", Icons.Rounded.Close, c.tile, c.ink, Modifier, Haptic.Light) { onEvent(PeopleEvent.CancelRemove) }
        } else {
            Bar("Done", Icons.Rounded.Check, c.sage, c.onSage, Modifier.weight(1f), Haptic.Success) { onEvent(PeopleEvent.Close) }
            if (!p.me) Bar("", Icons.Rounded.Delete, c.crit.copy(alpha = 0.16f), c.crit, Modifier, Haptic.Medium) { onEvent(PeopleEvent.AskRemove) }
        }
    }
}

@Composable
private fun Bar(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, bg: Color, ink: Color, modifier: Modifier, haptic: Haptic, onClick: () -> Unit) {
    Pressable(modifier.height(52.dp), CircleShape, bg, depth = 0.96f, haptic = haptic, onClick = onClick) {
        Row(Modifier.align(Alignment.Center).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, if (label.isEmpty()) "Remove from the home" else null, tint = ink)
            if (label.isNotEmpty()) Text(label, style = AliceType.bodyStrong.copy(fontSize = 16.sp), color = ink)
        }
    }
}

@Preview(showBackground = true, widthDp = 412, heightDp = 915)
@Composable
private fun PeopleContentPreview() {
    com.alice.home.ui.theme.AliceTheme {
        PeopleContent(state = PeopleUiState(household = MockAliceRepository().state.value), onEvent = {})
    }
}
