package com.alice.home.ui.rooms

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import androidx.compose.foundation.verticalScroll
import com.alice.home.ui.components.AccordionList
import com.alice.home.ui.components.AccordionPane
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filterNotNull
import com.alice.home.ui.components.Peek
import com.alice.home.ui.components.PeekStack
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.MeetingRoom
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alice.home.data.mock.MockAliceRepository
import com.alice.home.di.AppGraph
import com.alice.home.domain.model.Device
import com.alice.home.domain.model.Kind
import com.alice.home.ui.Haptic
import com.alice.home.ui.LocalHaptics
import com.alice.home.domain.model.tod
import com.alice.home.ui.Motion
import com.alice.home.ui.components.AliceWordmark
import com.alice.home.ui.components.DeviceRow
import com.alice.home.ui.components.FilterChip
import com.alice.home.ui.components.GlassTabBar
import com.alice.home.ui.components.GlassToast
import com.alice.home.ui.components.IconButtonCircle
import com.alice.home.ui.components.IconChip
import com.alice.home.ui.components.LevelScrub
import com.alice.home.ui.components.ListRow
import com.alice.home.ui.components.PillButton
import com.alice.home.ui.components.SearchField
import com.alice.home.ui.components.SectionHeader
import com.alice.home.ui.components.Segmented
import com.alice.home.ui.components.Tile
import com.alice.home.ui.components.hero
import com.alice.home.ui.components.icon
import com.alice.home.ui.components.recordBackdrop
import com.alice.home.ui.components.state
import com.alice.home.ui.home.DevicePopup
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Rooms is a catalogue screen (design-bible §12): content first, one filter bar, devices as full-width rows, and the per-device
 * management (favourite, voice, hide) inside the device popup. The glance tiles with drag and hold-slide stay on Home.
 */
@Composable
fun RoomsScreen(
    tab: Int = 1,
    onTab: (Int) -> Unit = {},
    backdrop: GraphicsLayer = rememberGraphicsLayer(),
    onMinimizedChange: (Boolean) -> Unit = {},
    onNestedChange: (Boolean) -> Unit = {},
    vm: RoomsViewModel = viewModel { RoomsViewModel(AppGraph.repository) },
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    RoomsContent(state = state, onEvent = vm::onEvent, tab = tab, onTab = onTab, backdrop = backdrop, onMinimizedChange = onMinimizedChange)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RoomsContent(
    state: RoomsUiState,
    onEvent: (RoomsEvent) -> Unit,
    tab: Int = 1,
    onTab: (Int) -> Unit = {},
    backdrop: GraphicsLayer = rememberGraphicsLayer(),
    onMinimizedChange: (Boolean) -> Unit = {},
) {
    val c = Alice.c
    val household = state.household
    val admin = household.role == "admin"
    val scope = rememberCoroutineScope()
    val haptics = LocalHaptics.current
    val density = LocalDensity.current
    var pop by remember { mutableStateOf<Pair<String, Rect>?>(null) }
    val pp = remember { Animatable(0f) }      // presence: the dim, the blur and the card's fade
    val morph = remember { Animatable(0f) }   // the card growing out of its row (opening only; closing just fades)
    val screenW = LocalConfiguration.current.screenWidthDp
    val scrub = remember { LevelScrub(haptics, with(density) { (screenW - 92).dp.toPx() }) }
    fun closePop() { scrub.end(); scope.launch { pp.animateTo(0f, tween(220, easing = Motion.easeIn)); pop = null } }
    LaunchedEffect(pop?.first) {
        if (pop != null) {
            morph.snapTo(0f)
            launch { morph.animateTo(1f, spring(dampingRatio = 0.74f, stiffness = 230f)) }
            pp.animateTo(1f, spring(dampingRatio = 0.74f, stiffness = 230f))
        }
    }
    // One pane per group (and one for the hidden devices). The list area turns scrolling into opening and closing them.
    val panes: List<AccordionPane> = buildList {
        state.groups.forEach { group ->
            add(AccordionPane(
                key = groupKey(state.groupBy, group.title), title = group.title, hint = group.subtitle,
                peek = {
                    // a folded group previews its contents: the kinds of device in a room, the brands in a type
                    PeekStack(
                        if (state.groupBy == GroupBy.Room) group.devices.distinctBy { it.kind }.map { Peek(icon = it.icon()) }
                        else group.devices.map { it.hardware }.filter { it.isNotBlank() }.distinct().map { Peek(letter = it.take(1).uppercase()) },
                    )
                },
            ) {
                val row: @Composable (Device, Boolean) -> Unit = { d, divider ->
                    if (divider) Box(Modifier.padding(start = 66.dp).fillMaxWidth().height(1.dp).background(c.line))
                    DeviceRow(d, subtitle = "${d.state()} · ${d.room}".takeIf { state.groupBy == GroupBy.Type } ?: d.state(), onOpen = { r -> pop = d.id to r }, onToggle = { onEvent(RoomsEvent.ToggleDevice(d.id)) })
                }
                val sections = group.sections
                if (sections == null) group.devices.forEachIndexed { i, d -> row(d, i > 0) }
                else sections.forEachIndexed { si, sec ->
                    BrandLabel(sec.title, sec.devices.size, first = si == 0)
                    sec.devices.forEachIndexed { i, d -> row(d, i > 0) }
                }
            })
        }
        if (admin && state.hidden.isNotEmpty()) add(AccordionPane("hidden", "Hidden", "${state.hidden.size} you hid from Alice", null) {
            state.hidden.forEachIndexed { i, h ->
                if (i > 0) Box(Modifier.padding(start = 66.dp).fillMaxWidth().height(1.dp).background(c.line))
                ListRow(
                    icon = h.icon(), title = h.name, subtitle = h.room, iconSize = 40.dp, contentPadding = 12.dp,
                    trailing = { PillButton("Show again", { onEvent(RoomsEvent.SetHidden(h.id, false)) }, color = c.sage, ink = c.onSage) },
                )
            }
        })
    }
    val barInset = 104.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val (heroA, heroB, ink, chip) = hero(tod(), c.dark)
    val active = household.devices.count { !it.hidden && it.on }

    Box(Modifier.fillMaxSize().background(c.bg)) {
        Box(Modifier.fillMaxSize().graphicsLayer { val r = pp.value * 36f; renderEffect = if (r > 0.5f) BlurEffect(r, r, TileMode.Clamp) else null }) {
            Box(Modifier.fillMaxSize().recordBackdrop(backdrop)) {
                Column(Modifier.fillMaxSize()) {
                    // 1. Compact hero, fixed: it is Home's hero with less in it (same sky and wordmark, a live status line, one row of counts).
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp))
                            .background(Brush.verticalGradient(listOf(heroA, heroB)))
                            .statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 22.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        AliceWordmark(Modifier.weight(1f), size = 30.sp, color = ink)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            IconButtonCircle(
                                Icons.Rounded.Search, { onEvent(RoomsEvent.ToggleSearch) }, size = 44.dp, haptic = Haptic.Select, contentDescription = "Search",
                                bg = if (state.searchOpen) ink else chip, tint = if (state.searchOpen) heroB else ink,
                            )
                            Box {
                                IconButtonCircle(
                                    Icons.Rounded.Tune, { onEvent(RoomsEvent.ToggleView) }, size = 44.dp, haptic = Haptic.Select, contentDescription = "View options",
                                    bg = if (state.viewOpen) ink else chip, tint = if (state.viewOpen) heroB else ink,
                                )
                                // a dot says the panel is hiding a choice that is not the default
                                if (state.viewChanged && !state.viewOpen) Box(Modifier.align(Alignment.TopEnd).size(10.dp).clip(CircleShape).background(c.glow))
                            }
                            com.alice.home.ui.components.SettingsButton(ink, chip)
                        }
                    }
                    Text("Rooms", style = AliceType.hero, color = ink)
                    Text("$active of ${state.totalCount} active", style = AliceType.heroSub, color = ink.copy(alpha = 0.92f))
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        IconChip(Icons.Rounded.Bolt, "${state.totalCount} devices", ink, chip)
                        IconChip(Icons.Rounded.MeetingRoom, "${state.roomCount} rooms", ink, chip)
                        if (state.voiceCount > 0) IconChip(Icons.Rounded.Mic, "${state.voiceCount} voice", ink, chip)
                    }
                    }
                    // 2. Search and view panels, closed until asked for.
                Column {
                    AnimatedVisibility(state.searchOpen, enter = expandVertically(Motion.release()) + fadeIn(), exit = shrinkVertically(tween(180)) + fadeOut(tween(120))) {
                        Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp)) {
                            SearchField(state.query, { onEvent(RoomsEvent.SetQuery(it)) }, "Search devices, rooms or hardware")
                        }
                    }
                    AnimatedVisibility(state.viewOpen, enter = expandVertically(Motion.release()) + fadeIn(), exit = shrinkVertically(tween(180)) + fadeOut(tween(120))) {
                        Tile(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp), c.tile, 12.dp) {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Segmented(
                                    items = listOf("room" to "By room", "type" to "By type"),
                                    selected = if (state.groupBy == GroupBy.Room) "room" else "type",
                                    onSelect = { onEvent(RoomsEvent.SetGroupBy(if (it == "room") GroupBy.Room else GroupBy.Type)) },
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    // an optional second level: within each type, split by company
                                    if (state.groupBy == GroupBy.Type) FilterChip("Then by brand", state.nestByBrand, { onEvent(RoomsEvent.ToggleNestByBrand) })
                                    if (admin) FilterChip("Voice-enabled", state.voiceOnly, { onEvent(RoomsEvent.ToggleVoiceOnly) }, count = state.voiceCount, icon = Icons.Rounded.Mic)
                                }
                                if (admin) {
                                    // explained when it matters, not on every visit
                                    if (state.voiceOnly) Text("Voice items are shared with Alexa and Google through Home Assistant Cloud. Locks are never shared.", style = AliceType.small, color = c.ink3)
                                }
                            }
                        }
                    }
                }

                    // 3. The list area: scrolling in here opens and closes the categories; nothing else on the screen moves.
                    if (panes.isEmpty()) {
                        Tile(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), c.tile, 16.dp) {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text(
                                    if (state.filtering) "Nothing matches. Try another word, or clear the filters." else "No devices yet. Add one in Home Assistant and it shows up here.",
                                    style = AliceType.body, color = c.ink2,
                                )
                                if (state.filtering) Row { PillButton("Clear filters", { onEvent(RoomsEvent.ClearFilters) }, color = c.tile2, ink = c.ink) }
                            }
                        }
                    } else if (state.query.isNotBlank()) {
                        // while searching every result is shown: a plain list, no accordion, so a match is never hidden inside a closed category
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(top = 6.dp, bottom = barInset)) {
                            panes.forEach { pane ->
                                SectionHeader(pane.title, pane.hint, minHeight = 44.dp)
                                Tile(Modifier.padding(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 10.dp), c.tile, 0.dp) { Column { pane.content() } }
                            }
                        }
                    } else {
                        AccordionList(panes, state.focus, { onEvent(RoomsEvent.Focus(it)) }, Modifier.weight(1f).padding(top = 4.dp), bottomInset = barInset)
                    }
                }
                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(130.dp).background(Brush.verticalGradient(0f to Color.Transparent, 0.7f to c.bg)))
            }
            GlassToast(state.toast, { onEvent(RoomsEvent.DismissToast) }, Modifier.align(Alignment.BottomCenter).padding(bottom = 104.dp).navigationBarsPadding())
        }
        pop?.let { (id, rect) ->
            Box(Modifier.fillMaxSize().graphicsLayer { alpha = pp.value.coerceIn(0f, 1f) }.background(Color.Black.copy(alpha = 0.38f)))
            household.devices.firstOrNull { it.id == id }?.let { d ->
                DevicePopup(
                    d, rect, { morph.value }, { pp.value }, scrub, { onEvent(RoomsEvent.CommitLevel(id, it)) }, ::closePop,
                    onHvacMode = { onEvent(RoomsEvent.SetHvacMode(id, it)) },
                    onOscillation = { onEvent(RoomsEvent.SetOscillation(id, it)) },
                    onColorTemp = { onEvent(RoomsEvent.SetColorTemp(id, it)) },
                    onColor = { onEvent(RoomsEvent.SetColor(id, it)) },
                    onFanPreset = { onEvent(RoomsEvent.SetFanPreset(id, it)) },
                    // management: any member can star; voice is an admin choice and never for locks or cameras; hiding is admin only
                    isFavourite = d.fav, onFavourite = { onEvent(RoomsEvent.ToggleFavourite(id)) },
                    voiceEnabled = if (admin && d.kind != Kind.Lock && d.kind != Kind.Camera) d.voice else null, onVoice = { onEvent(RoomsEvent.ToggleVoice(id)) },
                    onHide = if (admin) ({ onEvent(RoomsEvent.SetHidden(id, true)); closePop() }) else null,
                )
            }
        }
    }
}

/** A brand's label inside a type group: a monogram, the name, and how many. */
@Composable
private fun BrandLabel(brand: String, count: Int, first: Boolean) {
    val c = Alice.c
    Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 16.dp, top = if (first) 14.dp else 12.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(22.dp).clip(CircleShape).background(c.tile2), contentAlignment = Alignment.Center) { Text(brand.take(1).uppercase(), style = AliceType.label.copy(fontSize = 10.sp, lineHeight = 10.sp), color = c.ink2) }
        Text(brand.uppercase(), Modifier.weight(1f), style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink3)
        Text("$count", style = AliceType.mono, color = c.ink3)
    }
}

@Preview(showBackground = true, widthDp = 412, heightDp = 915)
@Composable
private fun RoomsContentPreview() {
    com.alice.home.ui.theme.AliceTheme {
        RoomsContent(
            state = RoomsUiState(household = MockAliceRepository().state.value),
            onEvent = {},
            tab = 1,
            onTab = {},
        )
    }
}
