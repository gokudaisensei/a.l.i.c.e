package com.alice.home.ui.automate

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
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PlaylistPlay
import androidx.compose.material.icons.rounded.Science
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alice.home.data.mock.MockAliceRepository
import com.alice.home.di.AppGraph
import com.alice.home.domain.model.Names
import com.alice.home.domain.model.Recipe
import com.alice.home.domain.model.RecipeKind
import com.alice.home.domain.model.pieces
import com.alice.home.domain.model.plain
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
import com.alice.home.ui.components.SentenceFlow
import com.alice.home.ui.components.Toggle
import com.alice.home.ui.components.hero
import com.alice.home.ui.components.recordBackdrop
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/**
 * Automate is a catalogue screen (design-bible §12) with one idea of its own: **the hero is the sentence**. In the list it is the
 * usual compact hero, and the three categories (automations, scenes, routines) scroll open one at a time. Open one to build or edit
 * and the hero turns into the live sentence ("When [someone gets home] if [it is dark] then [turn on Floor lamp]"): every highlighted
 * part is a button, and the panel below edits whichever part is open. You build by completing the sentence.
 */
@Composable
fun AutomateScreen(
    tab: Int = 2,
    onTab: (Int) -> Unit = {},
    backdrop: GraphicsLayer = rememberGraphicsLayer(),
    onMinimizedChange: (Boolean) -> Unit = {},
    onNestedChange: (Boolean) -> Unit = {},
    vm: AutomateViewModel = viewModel { AutomateViewModel(AppGraph.repository) },
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    AutomateContent(state = state, onEvent = vm::onEvent, tab = tab, onTab = onTab, backdrop = backdrop, onMinimizedChange = onMinimizedChange, onNestedChange = onNestedChange)
}

@Composable
internal fun AutomateContent(state: AutomateUiState, onEvent: (AutomateEvent) -> Unit, tab: Int = 2, onTab: (Int) -> Unit = {}, backdrop: GraphicsLayer = rememberGraphicsLayer(), onMinimizedChange: (Boolean) -> Unit = {}, onNestedChange: (Boolean) -> Unit = {}) {
    val c = Alice.c
    val household = state.household
    val names = remember(household) { household.names() }
    val haptics = LocalHaptics.current
    val builder = state.builder
    LaunchedEffect(builder != null) { onNestedChange(builder != null) }
    val barInset = 104.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    BackHandler(enabled = builder != null) { onEvent(AutomateEvent.Close) }

    Box(Modifier.fillMaxSize().background(c.bg)) {
        Box(Modifier.fillMaxSize().recordBackdrop(backdrop)) {
            Column(Modifier.fillMaxSize()) {
                AutomateHero(state, names, onEvent)
                if (builder == null) {
                    AccordionList(panes(state, names, onEvent), state.focus, { onEvent(AutomateEvent.Focus(it)) }, Modifier.weight(1f).padding(top = 4.dp), bottomInset = barInset)
                } else {
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 14.dp)) {
                        BuilderEditor(builder.draft, builder.slot, household, onEvent)
                        Spacer(Modifier.height(120.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()))
                    }
                }
            }
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(130.dp).background(Brush.verticalGradient(0f to Color.Transparent, 0.7f to c.bg)))
        }
        // the tab bar is now hoisted to the app shell; only the builder's own bar lives here
        AnimatedVisibility(builder != null, Modifier.align(Alignment.BottomCenter), enter = slideInVertically(tween(260)) { it } + fadeIn(), exit = slideOutVertically(tween(200)) { it } + fadeOut(tween(120))) {
            if (builder != null) BuilderBar(builder.draft, onEvent)
        }
        GlassToast(state.toast, { onEvent(AutomateEvent.DismissToast) }, Modifier.align(Alignment.BottomCenter).padding(bottom = if (builder == null) 104.dp else 96.dp).navigationBarsPadding())
    }
}

/** The compact hero, which becomes the sentence while something is being built. Same sky as every other screen. */
@Composable
private fun AutomateHero(state: AutomateUiState, names: Names, onEvent: (AutomateEvent) -> Unit) {
    val c = Alice.c
    val h = state.household
    val (heroA, heroB, ink, chip) = hero(tod(), c.dark)
    val b = state.builder
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp)).background(Brush.verticalGradient(listOf(heroA, heroB)))
            .statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 22.dp).animateContentSize(tween(260)),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            AliceWordmark(Modifier.weight(1f), size = 30.sp, color = ink)
            if (b == null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                IconButtonCircle(Icons.Rounded.Add, { onEvent(AutomateEvent.New) }, size = 44.dp, haptic = Haptic.Medium, contentDescription = "Build something new", bg = ink, tint = heroB)
                com.alice.home.ui.components.SettingsButton(ink, chip)
            }
            else IconButtonCircle(Icons.Rounded.Close, { onEvent(AutomateEvent.Close) }, size = 44.dp, haptic = Haptic.Light, contentDescription = "Close without saving", bg = chip, tint = ink)
        }
        AnimatedContent(b != null, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(120)) }, label = "hero") { building ->
            if (!building || b == null) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Automate", style = AliceType.hero, color = ink)
                    Text("${h.automationsOn} of ${h.automationCount} automations on", style = AliceType.heroSub, color = ink.copy(alpha = 0.92f))
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        IconChip(Icons.Rounded.Bolt, "${h.automationCount} automations", ink, chip)
                        IconChip(Icons.Rounded.AutoAwesome, "${h.sceneCount} scenes", ink, chip)
                        IconChip(Icons.Rounded.PlaylistPlay, "${h.routineCount} routines", ink, chip)
                    }
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text((if (b.draft.isNew) "NEW ${b.draft.kind.label}" else "EDITING ${b.draft.kind.label}").uppercase(), style = AliceType.mono, color = ink.copy(alpha = 0.75f))
                    SentenceFlow(b.draft.pieces(names), b.slot, ink, heroB, chip, { onEvent(AutomateEvent.SelectSlot(it)) })
                }
            }
        }
    }
}

/** Automations, scenes and routines as three categories for the accordion. Empty scenes and routines are left out; automations always show. */
private fun panes(state: AutomateUiState, names: Names, onEvent: (AutomateEvent) -> Unit): List<AccordionPane> {
    val h = state.household
    fun of(kind: RecipeKind) = h.recipes.filter { it.kind == kind }
    fun peek(list: List<Recipe>): @Composable () -> Unit = { PeekStack(list.map { Peek(icon = it.icon()) }.distinctBy { it.icon }) }
    return buildList {
        val autos = of(RecipeKind.Automation)
        add(AccordionPane("automations", "Automations", "${h.automationsOn} of ${h.automationCount} on", peek(autos)) {
            if (autos.isEmpty()) Text("No automations yet. Tap + to build one.", Modifier.padding(16.dp), style = AliceType.body, color = Alice.c.ink2)
            else RecipeRows(autos, names, onEvent)
        })
        val scenes = of(RecipeKind.Scene)
        if (scenes.isNotEmpty()) add(AccordionPane("scenes", "Scenes", "${scenes.size}", peek(scenes)) { RecipeRows(scenes, names, onEvent) })
        val routines = of(RecipeKind.Routine)
        if (routines.isNotEmpty()) add(AccordionPane("routines", "Routines", "${routines.size}", peek(routines)) { RecipeRows(routines, names, onEvent) })
    }
}

@Composable
private fun RecipeRows(list: List<Recipe>, names: Names, onEvent: (AutomateEvent) -> Unit) {
    val c = Alice.c
    Column {
        list.forEachIndexed { i, r ->
            if (i > 0) Box(Modifier.padding(start = 66.dp).fillMaxWidth().height(1.dp).background(c.line))
            RecipeRow(r, names, onOpen = { onEvent(AutomateEvent.Edit(r.id)) }, onToggle = { onEvent(AutomateEvent.SetEnabled(r.id, it)) }, onRun = { onEvent(AutomateEvent.Run(r.id)) })
        }
    }
}

/**
 * A recipe as a row that reads as its own sentence: a disc, the name, what it does in words (two lines before it truncates) and when it
 * last ran. Automations end in a switch, scenes and routines in a Run button. Tapping the row opens it in the builder.
 */
@Composable
private fun RecipeRow(r: Recipe, names: Names, onOpen: () -> Unit, onToggle: (Boolean) -> Unit, onRun: () -> Unit) {
    val c = Alice.c
    val live = r.kind != RecipeKind.Automation || r.enabled
    Pressable(Modifier.fillMaxWidth(), color = Color.Transparent, depth = 0.985f, haptic = Haptic.Light, onClick = onOpen) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconDisc(r.icon(), if (live) c.glowSoft else c.tile2, if (live) c.glowInk else c.ink3, size = 40.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(r.name, style = AliceType.bodyStrong, color = if (live) c.ink else c.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(r.lastRun, style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink3, maxLines = 1)
            }
            if (r.kind == RecipeKind.Automation) Toggle(r.enabled, onToggle)
            else PillButton("Run", onRun, color = c.sageSoft, ink = c.sage, icon = Icons.Rounded.PlayArrow)
        }
    }
}


/** Save, dry run and (for something that exists) remove, anchored at the bottom where a thumb rests. */
@Composable
private fun BuilderBar(d: Recipe, onEvent: (AutomateEvent) -> Unit) {
    val c = Alice.c
    Row(
        Modifier.fillMaxWidth().background(Brush.verticalGradient(0f to Color.Transparent, 0.35f to c.bg)).navigationBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 30.dp, bottom = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        BarButton(if (d.isNew) "Save" else "Save changes", Icons.Rounded.Check, c.sage, c.onSage, Modifier.weight(1f)) { onEvent(AutomateEvent.Save) }
        if (d.kind == RecipeKind.Automation) BarButton("Dry run", Icons.Rounded.Science, c.tile, c.ink, Modifier) { onEvent(AutomateEvent.DryRun) }
        if (!d.isNew) BarButton("", Icons.Rounded.Delete, c.critSoftOrFallback(), c.crit, Modifier) { onEvent(AutomateEvent.Delete) }
    }
}

private fun com.alice.home.ui.theme.AliceColors.critSoftOrFallback(): Color = crit.copy(alpha = 0.16f)

@Composable
private fun BarButton(label: String, icon: ImageVector, bg: Color, ink: Color, modifier: Modifier, onClick: () -> Unit) {
    Pressable(modifier.height(52.dp), CircleShape, bg, depth = 0.96f, haptic = if (bg == Alice.c.sage) Haptic.Success else Haptic.Medium, onClick = onClick) {
        Row(Modifier.align(Alignment.Center).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, if (label.isEmpty()) "Delete" else null, tint = ink)
            if (label.isNotEmpty()) Text(label, style = AliceType.bodyStrong.copy(fontSize = 16.sp), color = ink)
        }
    }
}

@Preview(showBackground = true, widthDp = 412, heightDp = 915)
@Composable
private fun AutomateContentPreview() {
    com.alice.home.ui.theme.AliceTheme {
        AutomateContent(state = AutomateUiState(household = MockAliceRepository().state.value), onEvent = {})
    }
}
