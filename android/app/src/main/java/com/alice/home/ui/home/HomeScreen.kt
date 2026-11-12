package com.alice.home.ui.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.Thermostat
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
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
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alice.home.data.HouseholdState
import com.alice.home.data.mock.MockAliceRepository
import com.alice.home.di.AppGraph
import com.alice.home.domain.model.Event
import com.alice.home.domain.model.Kind
import com.alice.home.domain.model.Lock
import com.alice.home.domain.model.Mode
import com.alice.home.domain.model.Person
import com.alice.home.domain.model.Scene
import com.alice.home.domain.model.Tod
import com.alice.home.domain.model.tod
import com.alice.home.ui.Haptic
import com.alice.home.ui.LocalHaptics
import com.alice.home.ui.Motion
import com.alice.home.ui.components.AlertBanner
import com.alice.home.ui.components.AliceWordmark
import com.alice.home.ui.components.hero
import com.alice.home.ui.components.Bento
import com.alice.home.ui.components.DeviceTile
import com.alice.home.ui.components.GlassTabBar
import com.alice.home.ui.components.GlassToast
import com.alice.home.ui.components.IconButtonCircle
import com.alice.home.ui.components.IconChip
import com.alice.home.ui.components.LevelScrub
import com.alice.home.ui.components.ListRow
import com.alice.home.ui.components.LockTile
import com.alice.home.ui.components.PillButton
import com.alice.home.ui.components.Pressable
import com.alice.home.ui.components.SceneCard
import com.alice.home.ui.components.SectionHeader
import com.alice.home.ui.components.Sparkline
import com.alice.home.ui.components.Stepper
import com.alice.home.ui.components.Tile
import com.alice.home.ui.components.recordBackdrop
import com.alice.home.ui.components.slidingPill
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import com.alice.home.ui.theme.AliceTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val GREET = mapOf(Tod.Morning to "Good morning", Tod.Day to "Good afternoon", Tod.Evening to "Good evening", Tod.Night to "Quiet night")

/**
 * The home screen. This overload is the only one that knows about the ViewModel; it collects its
 * state and hands everything to [HomeContent], which is a pure function of state + events.
 */
@Composable
fun HomeScreen(
    brandAlpha: Float = 1f,
    tab: Int = 0,
    onTab: (Int) -> Unit = {},
    backdrop: GraphicsLayer = rememberGraphicsLayer(),
    onMinimizedChange: (Boolean) -> Unit = {},
    onNestedChange: (Boolean) -> Unit = {},
    vm: HomeViewModel = viewModel { HomeViewModel(AppGraph.repository) },
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    HomeContent(state = state, onEvent = vm::onEvent, brandAlpha = brandAlpha, tab = tab, onTab = onTab, backdrop = backdrop, onMinimizedChange = onMinimizedChange)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun HomeContent(state: HomeUiState, onEvent: (HomeEvent) -> Unit, brandAlpha: Float, tab: Int = 0, onTab: (Int) -> Unit = {}, backdrop: GraphicsLayer = rememberGraphicsLayer(), onMinimizedChange: (Boolean) -> Unit = {}) {
    val c = Alice.c
    val household = state.household
    val scope = rememberCoroutineScope()
    val haptics = LocalHaptics.current
    val density = LocalDensity.current
    var pop by remember { mutableStateOf<Pair<String, Rect>?>(null) }
    val pp = remember { Animatable(0f) }      // presence: the dim, the blur and the card's fade
    val morph = remember { Animatable(0f) }   // the card growing out of its tile (opening only; closing just fades)
    // the popup's bar is the screen minus the card's margins and padding; the bar reports its real width once it is drawn
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
    var refreshing by remember { mutableStateOf(false) }
    var minimized by remember { mutableStateOf(false) }
    val editMode = state.editMode
    var pull by remember { mutableFloatStateOf(0f) }       // 0 to 1: how far the arrange pull is
    val edit by animateFloatAsState(if (editMode) 1f else 0f, tween(280, easing = Motion.easeOut), label = "edit")
    // while arranging, the rest of the page steps back so the cards are what you see
    val dim = Modifier.graphicsLayer { alpha = 1f - 0.62f * edit }
    androidx.activity.compose.BackHandler(enabled = editMode) { onEvent(HomeEvent.ExitEdit) }
    val t = tod()
    val suggested = household.scenes.getOrNull(if (t == Tod.Night) 2 else if (t == Tod.Morning) 0 else 1)
    val scroll = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (available.y < -8f) { minimized = true; onMinimizedChange(true) } else if (available.y > 8f) { minimized = false; onMinimizedChange(false) }
                return Offset.Zero
            }
        }
    }

    Box(Modifier.fillMaxSize().background(c.bg)) {
      Box(Modifier.fillMaxSize().graphicsLayer { val r = pp.value * 36f; renderEffect = if (r > 0.5f) BlurEffect(r, r, TileMode.Clamp) else null }) {
        // everything behind the floating bar is recorded, so the glass can blur and bend it
        Box(Modifier.fillMaxSize().recordBackdrop(backdrop).nestedScroll(scroll)) {
            PullToRefreshBox(refreshing, {
                haptics.play(Haptic.Medium)
                scope.launch {
                    refreshing = true
                    onEvent(HomeEvent.Refresh)
                    delay(900)
                    refreshing = false
                    haptics.play(Haptic.Success)
                }
            }) {
                LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(bottom = 130.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    item {
                        Hero(
                            household = household,
                            suggestion = suggested,
                            brandAlpha = brandAlpha,
                            onScene = { suggested?.let { onEvent(HomeEvent.RunScene(it.name)) } },
                        )
                    }
                    household.alert?.let { a -> item { Box(dim) { AlertBanner(a, onAck = { onEvent(HomeEvent.AcknowledgeAlert) }) } } }
                    item {
                        Box(dim) {
                        ModeTile(
                            selected = household.mode,
                            suggestion = household.suggestion,
                            onChoose = { onEvent(HomeEvent.ChooseMode(it)) },
                            onDismiss = { onEvent(HomeEvent.DismissSuggestion) },
                        )
                        }
                    }
                    item {
                        ArrangeHeader(editMode, pull, { pull = it }, { onEvent(HomeEvent.EnterEdit) }, { onEvent(HomeEvent.ExitEdit) })
                    }
                    item {
                        DeviceGrid(
                            devices = household.favourites.sortedBy { d -> state.order.indexOf(d.id).let { if (it < 0) Int.MAX_VALUE else it } },
                            sizes = state.sizes,
                            editMode = editMode,
                            selectedId = state.selectedId,
                            anticipate = pull,
                            onSelect = { onEvent(HomeEvent.SelectCard(it)) },
                            onResize = { id, size -> onEvent(HomeEvent.ResizeCard(id, size)) },
                            onMove = { id, by -> onEvent(HomeEvent.MoveCard(id, by)) },
                            onTapDevice = { d -> onEvent(HomeEvent.ToggleDevice(d.id)) },
                            onHoldDevice = { d, r -> pop = d.id to r },
                            onCommitDevice = { d, level -> onEvent(HomeEvent.CommitLevel(d.id, level)) },
                            onHoldDragStart = { d -> scrub.begin(if (d.on) d.level else 0) },
                            onHoldDrag = { d, dy -> if (d.kind != Kind.Plug) scrub.move(dy) { onEvent(HomeEvent.CommitLevel(d.id, it)) } },
                            onHoldDragEnd = { _ -> scrub.end() },
                            onDeleteDevice = { d -> onEvent(HomeEvent.RemoveFavourite(d.id)) },
                            modifier = Modifier.padding(horizontal = 16.dp),
                        )
                    }
                    item { Box(dim) { EnergyTile(household.kw, household.energy, Modifier.padding(horizontal = 16.dp).height(116.dp)) } }
                    item { Box(dim) { PeopleRow(household.people) } }
                    item {
                        Box(dim) {
                        ActivityTile(
                            activity = household.activity,
                            open = state.activityOpen,
                            onToggle = { haptics.play(Haptic.Select); onEvent(HomeEvent.ToggleActivity) },
                        )
                        }
                    }
                }
            }
            // soft scroll edge under the bar: content melts into the page instead of ending on a line
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(130.dp).background(Brush.verticalGradient(0f to Color.Transparent, 0.7f to c.bg)))
        }
        androidx.compose.animation.AnimatedVisibility(
            editMode, Modifier.align(Alignment.BottomCenter).padding(bottom = 104.dp).navigationBarsPadding(),
            enter = androidx.compose.animation.slideInVertically(tween(260)) { it } + androidx.compose.animation.fadeIn(),
            exit = androidx.compose.animation.slideOutVertically(tween(200)) { it } + androidx.compose.animation.fadeOut(tween(120)),
        ) { ArrangeBar(state.selectedId != null, { onEvent(HomeEvent.ResetLayout) }, { onEvent(HomeEvent.ExitEdit) }) }
        GlassToast(state.toast, { onEvent(HomeEvent.DismissToast) }, Modifier.align(Alignment.BottomCenter).padding(bottom = if (editMode) 170.dp else 104.dp).navigationBarsPadding())
      }
      pop?.let { (id, rect) ->
          Box(Modifier.fillMaxSize().graphicsLayer { alpha = pp.value.coerceIn(0f, 1f) }.background(Color.Black.copy(alpha = 0.38f)))
          household.devices.firstOrNull { it.id == id }?.let { d ->
              DevicePopup(d, rect, { morph.value }, { pp.value }, scrub, { onEvent(HomeEvent.CommitLevel(id, it)) }, ::closePop,
                  onHvacMode = { onEvent(HomeEvent.SetHvacMode(id, it)) },
                  onOscillation = { onEvent(HomeEvent.SetOscillation(id, it)) },
                  onColorTemp = { onEvent(HomeEvent.SetColorTemp(id, it)) },
                  onColor = { onEvent(HomeEvent.SetColor(id, it)) },
                  onFanPreset = { onEvent(HomeEvent.SetFanPreset(id, it)) },
              )
          }
      }
    }
}

@Composable
private fun Hero(household: HouseholdState, suggestion: Scene?, brandAlpha: Float, onScene: () -> Unit) {
    val t = tod()
    val (a, b, ink, chip) = hero(t, Alice.c.dark)
    val unlocked = household.unlockedCount
    val line = if (household.needsAttention) "A couple of things need a look." else "Everything is calm."
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp)).background(Brush.verticalGradient(listOf(a, b)))
            .statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 22.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            AliceWordmark(Modifier.weight(1f).graphicsLayer { alpha = brandAlpha }, size = 30.sp, color = ink)
            com.alice.home.ui.components.SettingsButton(ink, chip)
        }
        Text("${GREET[t]}, Gokul.", style = AliceType.hero, color = ink)
        Text(line, style = AliceType.heroSub, color = ink.copy(alpha = 0.92f))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconChip(Icons.Rounded.Lock, if (unlocked == 0) "Doors locked" else "$unlocked unlocked", ink, chip)
            IconChip(Icons.Rounded.Home, "${household.homeCount} home", ink, chip)
            IconChip(Icons.Rounded.Bolt, "%.2f kW".format(household.kw), ink, chip)
        }
        if (suggestion != null) {
            Spacer(Modifier.height(4.dp))
            Pressable(Modifier.fillMaxWidth().height(54.dp), CircleShape, ink, depth = 0.96f, haptic = Haptic.Medium, onClick = onScene) {
                Row(Modifier.align(Alignment.Center), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(sceneIcon(suggestion.icon), null, tint = b, modifier = Modifier.size(20.dp))
                    Text(suggestion.name, style = AliceType.bodyStrong.copy(fontSize = 16.sp), color = b)
                }
            }
        }
    }
}

@Composable
private fun ModeTile(selected: Mode, suggestion: Mode?, onChoose: (Mode) -> Unit, onDismiss: () -> Unit) {
    val c = Alice.c
    val modes = Mode.entries
    var w by remember { mutableFloatStateOf(1f) }
    val x by animateFloatAsState(w / modes.size * modes.indexOf(selected), Motion.release(), label = "pill") // the pill slides with the spring
    Tile(Modifier.padding(horizontal = 16.dp), c.sageSoft, 8.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                Modifier.onSizeChanged { w = it.width.toFloat() }.slidingPill(modes.size, x, 16.dp, c.sage),
                horizontalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                modes.forEach { m ->
                    val sel = selected == m
                    val ink by animateColorAsState(if (sel) c.onSage else c.ink2, Motion.ui(), label = "ink")
                    Pressable(Modifier.weight(1f), RoundedCornerShape(16.dp), Color.Transparent, depth = 0.96f, haptic = Haptic.Select, onClick = { onChoose(m) }) {
                        Column(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(modeIcon(m), null, tint = ink, modifier = Modifier.size(22.dp))
                            Text(m.label, style = AliceType.label, color = ink, maxLines = 1)
                        }
                    }
                }
            }
            suggestion?.let { s ->
                Row(Modifier.padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Rounded.AutoAwesome, null, tint = c.sage, modifier = Modifier.size(16.dp))
                    Text("Switch to ${s.label}? It's getting late.", Modifier.weight(1f), style = AliceType.small, color = c.ink)
                    PillButton("Switch", { onChoose(s) })
                    IconButtonCircle(Icons.Rounded.Close, onDismiss, size = 32.dp, bg = Color.Transparent, tint = c.ink2, contentDescription = "Not now")
                }
            }
        }
    }
}

@Composable
private fun DoorsTile(locks: List<Lock>, onToggle: (String) -> Unit, onLockAll: () -> Unit) {
    val c = Alice.c
    Tile(Modifier.padding(horizontal = 16.dp), c.deep, 10.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { locks.forEach { LockTile(it, Modifier.weight(1f)) { onToggle(it.id) } } }
            if (locks.any { !it.locked }) Pressable(Modifier.fillMaxWidth(), RoundedCornerShape(16.dp), c.deepInk, haptic = Haptic.Success, onClick = onLockAll) {
                Text("Lock everything", Modifier.fillMaxWidth().padding(vertical = 12.dp), style = AliceType.bodyStrong, color = c.deep, textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun ClimateTile(target: Int, onStep: (Int) -> Unit, modifier: Modifier) {
    val c = Alice.c
    Tile(modifier, c.claySoft, 14.dp) {
        Column(Modifier.fillMaxHeight(), verticalArrangement = Arrangement.SpaceBetween) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Thermostat, null, tint = c.clay, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("LIVING ROOM AC", Modifier.weight(1f), style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink2, maxLines = 1)
            }
            Text("26.4°", style = AliceType.big, color = c.ink)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Stepper(Icons.Rounded.Remove, { onStep(-1) }, atLimit = target <= 16)
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("${target}°", style = AliceType.bodyStrong, color = c.ink)
                    Text("target", style = AliceType.small, color = c.ink3)
                }
                Stepper(Icons.Rounded.Add, { onStep(1) }, atLimit = target >= 30)
            }
        }
    }
}

@Composable
private fun EnergyTile(kw: Float, energy: List<Float>, modifier: Modifier) {
    val c = Alice.c
    Tile(modifier, c.tile, 14.dp) {
        Column(Modifier.fillMaxHeight(), verticalArrangement = Arrangement.SpaceBetween) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Bolt, null, tint = c.glowInk, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("ENERGY NOW", style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink2)
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Text("%.2f".format(kw), style = AliceType.big, color = c.ink)
                Text(" kW", Modifier.padding(bottom = 4.dp), style = AliceType.small, color = c.ink2)
            }
            Sparkline(energy, c.sage, Modifier.fillMaxWidth().height(40.dp))
            Text("Today 11.4 kWh", style = AliceType.small, color = c.ink3)
        }
    }
}

@Composable
private fun PeopleRow(people: List<Person>) {
    val c = Alice.c
    Tile(Modifier.padding(horizontal = 16.dp), c.tile, 12.dp) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            people.forEach { p ->
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(Modifier.size(52.dp).clip(CircleShape).background(if (p.home) c.sage else c.tile2), contentAlignment = Alignment.Center) {
                        Text(p.name.take(1), style = AliceType.section, color = if (p.home) c.onSage else c.ink3)
                    }
                    Text(p.name, style = AliceType.label, color = c.ink)
                    Text(if (p.home) "Home" else "Away", style = AliceType.small, color = if (p.home) c.ok else c.ink3)
                }
            }
        }
    }
}

@Composable
private fun ActivityTile(activity: List<Event>, open: Boolean, onToggle: () -> Unit) {
    val c = Alice.c
    val fresh = activity.count { it.fresh }
    Tile(Modifier.padding(horizontal = 16.dp), c.tile, 0.dp) {
        Column {
            ListRow(
                icon = Icons.Rounded.Notifications,
                title = "$fresh new since you were away",
                subtitle = activity.firstOrNull()?.text.orEmpty(),
                iconBg = c.tile2,
                iconFg = c.ink2,
                spacing = 12.dp,
                contentPadding = 14.dp,
                haptic = null,
                depth = 0.98f,
                onClick = onToggle,
                trailing = { Icon(Icons.Rounded.ExpandMore, null, tint = c.ink3) },
            )
            AnimatedVisibility(open) {
                Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    activity.forEach { e ->
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(e.time, Modifier.width(72.dp), style = AliceType.mono, color = c.ink3)
                            Text(e.text, style = AliceType.body.copy(fontSize = 14.sp), color = c.ink)
                        }
                    }
                }
            }
        }
    }
}

/**
 * The Favourites title is also the way into arranging: pull it down, like pulling a drawer, and the cards loosen as you go (they shrink a
 * hair and their outlines fade in); past the line a tick marks the moment and letting go starts arranging. Pulling up is left to the page
 * (it scrolls). A button does the same for anyone who prefers a tap. While arranging, the same row shows what to do and a Done button.
 */
@Composable
private fun ArrangeHeader(editMode: Boolean, pull: Float, onPull: (Float) -> Unit, onEnter: () -> Unit, onExit: () -> Unit) {
    val c = Alice.c
    val haptics = LocalHaptics.current
    val density = LocalDensity.current
    val threshold = with(density) { 88.dp.toPx() }
    val onPullNow by rememberUpdatedState(onPull)
    val onEnterNow by rememberUpdatedState(onEnter)
    var raw by remember { mutableFloatStateOf(0f) }  // px pulled
    var held by remember { mutableStateOf(false) }
    val shift by animateFloatAsState(raw * 0.45f, if (held) snap() else Motion.release(), label = "pullShift")
    val ready = pull >= 1f
    Row(
        Modifier.fillMaxWidth().graphicsLayer { translationY = shift }.padding(horizontal = 20.dp)
            .pointerInput(editMode) {
                if (editMode) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    var total = Offset.Zero
                    var mine = false
                    var crossed = false
                    while (true) {
                        val ch = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                        if (ch.changedToUp()) break
                        total += ch.positionChange()
                        if (!mine && total.getDistance() > viewConfiguration.touchSlop) {
                            if (total.y > 0f && total.y > kotlin.math.abs(total.x)) { mine = true; held = true } else break  // up or sideways: not ours
                        }
                        if (mine) {
                            ch.consume()
                            raw = total.y.coerceAtLeast(0f)
                            val p = (raw / threshold).coerceIn(0f, 1f)
                            onPullNow(p)
                            if (p >= 1f && !crossed) { crossed = true; haptics.play(Haptic.Detent) } else if (p < 1f) crossed = false
                        }
                    }
                    held = false
                    val enter = mine && raw >= threshold
                    raw = 0f; onPullNow(0f)
                    if (enter) { haptics.play(Haptic.Success); onEnterNow() }
                }
            },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(Modifier.weight(1f)) {
            Text("Favourites", style = AliceType.section, color = c.ink)
            AnimatedContent(
                if (editMode) "Tap a card, then drag its dots" else if (pull > 0f) (if (ready) "Let go to arrange" else "Keep pulling to arrange") else "",
                transitionSpec = { fadeIn(tween(120)) togetherWith fadeOut(tween(90)) }, label = "hint",
            ) { t -> if (t.isNotEmpty()) Text(t, style = AliceType.small, color = if (ready) c.glowInk else c.ink3) }
        }
        PillButton(if (editMode) "Done" else "Arrange", { if (editMode) onExit() else onEnter() }, color = if (editMode) c.sage else c.tile2, ink = if (editMode) c.onSage else c.ink)
    }
}

/** Floating over the tab bar while arranging: what the selected card can do next, and a way back to the default layout. */
@Composable
private fun ArrangeBar(hasSelection: Boolean, onReset: () -> Unit, onDone: () -> Unit) {
    val c = Alice.c
    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        PillButton("Done", onDone, color = c.sage, ink = c.onSage, haptic = Haptic.Success, padding = PaddingValues(horizontal = 22.dp, vertical = 12.dp))
        PillButton("Reset layout", onReset, color = c.tile, ink = c.ink, haptic = Haptic.Medium, padding = PaddingValues(horizontal = 18.dp, vertical = 12.dp))
    }
}

/**
 * The favourites as a responsive grid of cards. The number of columns follows the width (about 104dp a cell, from 3 on a phone to 6 on a
 * tablet or in landscape) and a cell is nearly square, so a card keeps its shape on any screen. A card is 1×1 normally; arranging makes it
 * 1 wide by 2 tall or 2×2 (see [ResizeFrame]). Cards are packed in order into the first free spot, so a big one leaves no overlap, and
 * every card glides to its place with a spring when something above it grows or shrinks.
 *
 * [anticipate] is 0 to 1 while the arrange pull is still under the finger: the cards shrink a hair and their outlines fade in.
 */
@Composable
fun DeviceGrid(
    devices: List<com.alice.home.domain.model.Device>,
    sizes: Map<String, com.alice.home.ui.components.DeviceCardSize>,
    editMode: Boolean,
    selectedId: String?,
    anticipate: Float,
    onSelect: (String) -> Unit,
    onResize: (String, com.alice.home.ui.components.DeviceCardSize) -> Unit,
    onMove: (String, Int) -> Unit,
    onTapDevice: (com.alice.home.domain.model.Device) -> Unit,
    onHoldDevice: (com.alice.home.domain.model.Device, androidx.compose.ui.geometry.Rect) -> Unit,
    onCommitDevice: (com.alice.home.domain.model.Device, Int) -> Unit,
    onHoldDragStart: (com.alice.home.domain.model.Device) -> Unit,
    onHoldDrag: (com.alice.home.domain.model.Device, Float) -> Unit,
    onHoldDragEnd: (com.alice.home.domain.model.Device) -> Unit,
    onDeleteDevice: (com.alice.home.domain.model.Device) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val gap = 10.dp
    androidx.compose.foundation.layout.BoxWithConstraints(modifier.fillMaxWidth()) {
        // 3 on any phone, however large its display size is set; more only from tablet width
        val columns = if (maxWidth < 568.dp) 3 else if (maxWidth < 800.dp) 4 else 6
        val cellW = (maxWidth - gap * (columns - 1)) / columns
        val cellH = cellW * 0.95f
        val spans = devices.map { sizes[it.id] ?: com.alice.home.ui.components.DeviceCardSize.Small }
        val packed = remember(spans, columns) { packCards(spans, columns) }
        val totalH by animateDpAsState(if (packed.rows == 0) 0.dp else cellH * packed.rows + gap * (packed.rows - 1), spring(0.85f, 400f), label = "gridH")
        val spec = spring<androidx.compose.ui.unit.Dp>(dampingRatio = 0.82f, stiffness = 420f)
        Box(Modifier.fillMaxWidth().height(totalH)) {
            devices.forEachIndexed { i, d ->
                androidx.compose.runtime.key(d.id) {
                    val s = spans[i]
                    val (r, c0) = packed.at[i]
                    val x by animateDpAsState((cellW + gap) * c0, spec, label = "x")
                    val y by animateDpAsState((cellH + gap) * r, spec, label = "y")
                    val w by animateDpAsState(cellW * s.colSpan + gap * (s.colSpan - 1), spec, label = "w")
                    val h by animateDpAsState(cellH * s.rowSpan + gap * (s.rowSpan - 1), spec, label = "h")
                    val m = com.alice.home.ui.components.FrameMargin
                    // the frame reaches past the card so its dots can be grabbed from just outside the outline; the selected one is on top
                    Box(Modifier.offset(x - m, y - m).size(w + m * 2, h + m * 2).zIndex(if (editMode && selectedId == d.id) 1f else 0f)) {
                        com.alice.home.ui.components.ResizeFrame(
                            size = s,
                            selected = editMode && selectedId == d.id,
                            visible = if (editMode) 1f else anticipate,
                            stepX = with(density) { (cellW + gap).toPx() },
                            stepY = with(density) { (cellH + gap).toPx() },
                            onSelect = { onSelect(d.id) },
                            atRightEdge = c0 + s.colSpan >= columns,
                            // widening a card that would run off the right edge makes room by moving it left in the order
                            onResize = { new ->
                                onResize(d.id, new)
                                val over = c0 + new.colSpan - columns
                                if (over > 0) onMove(d.id, -over)
                            },
                            onDelete = { onDeleteDevice(d) },
                        ) {
                            Box(Modifier.fillMaxSize().graphicsLayer { val k = 1f - 0.03f * anticipate; scaleX = k; scaleY = k }) {
                                com.alice.home.ui.components.DeviceTile(
                                    d = d,
                                    cardSize = s,
                                    editMode = editMode,
                                    onTap = { onTapDevice(d) },
                                    onHold = { rect -> onHoldDevice(d, rect) },
                                    onCommit = { lvl -> onCommitDevice(d, lvl) },
                                    onHoldDragStart = { onHoldDragStart(d) },
                                    onHoldDrag = { dy -> onHoldDrag(d, dy) },
                                    onHoldDragEnd = { onHoldDragEnd(d) },
                                    onDelete = { onDeleteDevice(d) },
                                    showDelete = editMode,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Where each card goes (row, column), and how many rows the grid needs. First free spot, in order, left to right. */
internal class PackedCards(val at: List<Pair<Int, Int>>, val rows: Int)

internal fun packCards(spans: List<com.alice.home.ui.components.DeviceCardSize>, columns: Int): PackedCards {
    val taken = mutableSetOf<Pair<Int, Int>>()
    var rows = 0
    val at = spans.map { s ->
        var r = 0
        var found: Pair<Int, Int>? = null
        while (found == null) {
            for (c in 0..(columns - s.colSpan)) {
                val free = (r until r + s.rowSpan).all { rr -> (c until c + s.colSpan).all { cc -> (rr to cc) !in taken } }
                if (free) { found = r to c; break }
            }
            if (found == null) r++
        }
        val (fr, fc) = found
        for (rr in fr until fr + s.rowSpan) for (cc in fc until fc + s.colSpan) taken.add(rr to cc)
        rows = maxOf(rows, fr + s.rowSpan)
        found
    }
    return PackedCards(at, rows)
}

/**
 * The whole screen as a pure function of a snapshot, so it can be previewed and tested without a
 * ViewModel or a repository — see `android/docs/architecture.md` §9–10.
 */
@Preview(showBackground = true, widthDp = 412, heightDp = 915)
@Composable
private fun HomeContentPreview() {
    AliceTheme {
        HomeContent(
            state = HomeUiState(household = MockAliceRepository().state.value),
            onEvent = {},
            brandAlpha = 1f,
            tab = 0,
            onTab = {},
        )
    }
}
