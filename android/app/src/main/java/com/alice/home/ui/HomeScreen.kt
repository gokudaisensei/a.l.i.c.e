package com.alice.home.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.MeetingRoom
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MeetingRoom
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.Thermostat
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alice.home.HomeViewModel
import com.alice.home.Kind
import com.alice.home.Mode
import com.alice.home.Tod
import com.alice.home.tod
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

private val GREET = mapOf(Tod.Morning to "Good morning", Tod.Day to "Good afternoon", Tod.Evening to "Good evening", Tod.Night to "Quiet night")

/** Time-of-day hero colours (a, b, ink, chip), as in the web `[data-tod]`. */
private fun hero(t: Tod, dark: Boolean): List<Color> = when {
    t == Tod.Morning && !dark -> listOf(0xFFF4DEA6, 0xFFE3A67C, 0xFF2A1C10, 0x80FFFFFF)
    t == Tod.Morning -> listOf(0xFF8B6B34, 0xFF5B3A24, 0xFFFBF0DC, 0x52140A00)
    t == Tod.Day && !dark -> listOf(0xFFD4E3D2, 0xFF9CC0A4, 0xFF15241A, 0x8CFFFFFF)
    t == Tod.Day -> listOf(0xFF3F5F48, 0xFF243A2E, 0xFFEAF1E6, 0x1AFFFFFF)
    t == Tod.Evening -> listOf(0xFFD07548, 0xFF7E3B2A, 0xFFFBEFE3, 0x521E0C06)
    else -> listOf(0xFF2E4442, 0xFF141F1F, 0xFFEFEADD, 0x1AFFFFFF)
}.map { Color(it) }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: HomeViewModel = viewModel()) {
    val c = Alice.c
    val scope = rememberCoroutineScope()
    val haptics = LocalHaptics.current
    val density = LocalDensity.current
    val backdrop = rememberGraphicsLayer()
    var pop by remember { mutableStateOf<Pair<String, Rect>?>(null) }
    val pp = remember { Animatable(0f) }      // presence: the dim, the blur and the card's fade
    val morph = remember { Animatable(0f) }   // the card growing out of its tile (opening only; closing just fades)
    // the popup's bar is the screen minus the card's margins and padding; the bar reports its real width once it is drawn
    val screenW = LocalConfiguration.current.screenWidthDp
    val scrub = remember { LevelScrub(haptics, with(density) { (screenW - 92).dp.toPx() }, with(density) { 12.dp.toPx() }) }
    fun closePop() { scope.launch { pp.animateTo(0f, tween(220, easing = Motion.easeIn)); pop = null } }
    LaunchedEffect(pop?.first) {
        if (pop != null) {
            morph.snapTo(0f)
            launch { morph.animateTo(1f, spring(dampingRatio = 0.74f, stiffness = 230f)) }
            pp.animateTo(1f, spring(dampingRatio = 0.74f, stiffness = 230f))
        }
    }
    var refreshing by remember { mutableStateOf(false) }
    var actOpen by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableIntStateOf(0) }
    var minimized by remember { mutableStateOf(false) }
    val t = tod()
    val suggested = vm.scenes[if (t == Tod.Night) 2 else if (t == Tod.Morning) 0 else 1]
    fun run(name: String) { toast = "$name started" }
    // the tab bar folds its labels while you read downward and returns on the way up (not at large text sizes, where labels are needed)
    val big = LocalDensity.current.fontScale >= 1.3f
    val scroll = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (available.y < -8f) minimized = true else if (available.y > 8f) minimized = false
                return Offset.Zero
            }
        }
    }

    Box(Modifier.fillMaxSize().background(c.bg)) {
      Box(Modifier.fillMaxSize().graphicsLayer { val r = pp.value * 36f; renderEffect = if (r > 0.5f) BlurEffect(r, r, TileMode.Clamp) else null }) {
        // everything behind the floating bar is recorded, so the glass can blur and bend it
        Box(Modifier.fillMaxSize().recordBackdrop(backdrop).nestedScroll(scroll)) {
            PullToRefreshBox(refreshing, { haptics.play(Haptic.Medium); scope.launch { refreshing = true; delay(900); refreshing = false; haptics.play(Haptic.Success) } }) {
                LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(bottom = 130.dp + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    item { Hero(vm, suggested.name, suggested.icon) { run(suggested.name) } }
                    vm.alert?.let { a -> item { AlertBanner(a, vm::ack) } }
                    item { ModeTile(vm) }
                    item { Box(Modifier.padding(horizontal = 16.dp)) { SectionHeader("Favourites", "Tap · hold for more") } }
                    items(vm.devices.chunked(3)) { row ->
                        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            row.forEach { d ->
                                DeviceTile(
                                    d, Modifier.weight(1f), { vm.toggle(d.id) }, { r -> pop = d.id to r }, { vm.commit(d.id, it) },
                                    // the finger that held the tile keeps going: sliding it sets the level in the popup
                                    onHoldDragStart = { scrub.begin(if (d.on) d.level else 0, settle = true) },
                                    onHoldDrag = if (d.kind != Kind.Plug) ({ dy -> scrub.move(dy) { vm.commit(d.id, it) } }) else ({ }),
                                )
                            }
                            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                    item { DoorsTile(vm) }
                    item { Box(Modifier.padding(horizontal = 16.dp)) { SectionHeader("Scenes") } }
                    item { Bento(vm.scenes, Modifier.padding(horizontal = 16.dp)) { s, m -> SceneCard(s.name, s.description, s.icon, s == suggested, m) { run(s.name) } } }
                    item {
                        Row(Modifier.padding(horizontal = 16.dp).height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            ClimateTile(vm, Modifier.weight(1f).fillMaxHeight())
                            EnergyTile(vm, Modifier.weight(1f).fillMaxHeight())
                        }
                    }
                    item { PeopleRow(vm) }
                    item { ActivityTile(vm, actOpen) { haptics.play(Haptic.Select); actOpen = !actOpen } }
                }
            }
            // soft scroll edge under the bar: content melts into the page instead of ending on a line
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(130.dp).background(Brush.verticalGradient(0f to Color.Transparent, 0.7f to c.bg)))
        }
        GlassTabBar(backdrop, tab, minimized && !big, { if (it != tab) haptics.play(Haptic.Select); tab = it }, Modifier.align(Alignment.BottomCenter))
        GlassToast(toast, Modifier.align(Alignment.BottomCenter).padding(bottom = 104.dp).navigationBarsPadding()) { toast = null }
      }
      pop?.let { (id, rect) ->
          Box(Modifier.fillMaxSize().graphicsLayer { alpha = pp.value.coerceIn(0f, 1f) }.background(Color.Black.copy(alpha = 0.38f)))
          vm.devices.firstOrNull { it.id == id }?.let { d -> DevicePopup(d, rect, { morph.value }, { pp.value }, scrub, { vm.commit(id, it) }, ::closePop) }
      }
    }
}

@Composable
private fun Hero(vm: HomeViewModel, sceneName: String, sceneIcon: ImageVector, onScene: () -> Unit) {
    val t = tod()
    val (a, b, ink, chip) = hero(t, Alice.c.dark)
    val now = LocalDateTime.now()
    val unlocked = vm.locks.count { !it.locked }
    val line = if (vm.alert != null || unlocked > 0) "A couple of things need a look." else "Everything is calm."
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp)).background(Brush.verticalGradient(listOf(a, b)))
            .statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 22.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(now.format(DateTimeFormatter.ofPattern("EEE d MMM · HH:mm", Locale.getDefault())).uppercase(), style = AliceType.mono, color = ink.copy(alpha = 0.75f))
        Text("${GREET[t]}, Gokul.", style = AliceType.hero, color = ink)
        Text(line, style = AliceType.heroSub, color = ink.copy(alpha = 0.92f))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(Icons.Rounded.Lock, if (unlocked == 0) "Doors locked" else "$unlocked unlocked", ink, chip)
            Chip(Icons.Rounded.Home, "${vm.people.count { it.home }} home", ink, chip)
            Chip(Icons.Rounded.Bolt, "%.2f kW".format(vm.kw), ink, chip)
        }
        Spacer(Modifier.height(4.dp))
        Pressable(Modifier.fillMaxWidth().height(54.dp), CircleShape, ink, depth = 0.96f, haptic = Haptic.Medium, onClick = onScene) {
            Row(Modifier.align(Alignment.Center), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(sceneIcon, null, tint = b, modifier = Modifier.size(20.dp))
                Text(sceneName, style = AliceType.bodyStrong.copy(fontSize = 16.sp), color = b)
            }
        }
    }
}

@Composable
private fun Chip(icon: ImageVector, text: String, ink: Color, bg: Color) {
    Row(Modifier.clip(CircleShape).background(bg).padding(start = 9.dp, end = 12.dp, top = 7.dp, bottom = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, null, tint = ink, modifier = Modifier.size(15.dp))
        Text(text, style = AliceType.label, color = ink)
    }
}

@Composable
private fun AlertBanner(text: String, onAck: () -> Unit) {
    val c = Alice.c
    Tile(Modifier.padding(horizontal = 16.dp), c.glowSoft, 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            IconDisc(Icons.Rounded.Warning, c.glow, Color(0xFF3A2A00))
            Text(text, Modifier.weight(1f), style = AliceType.bodyStrong, color = c.glowInk, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Pressable(shape = CircleShape, color = c.glow, haptic = Haptic.Success, onClick = onAck) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Icon(Icons.Rounded.Check, null, tint = Color(0xFF3A2A00), modifier = Modifier.size(16.dp))
                    Text("Got it", style = AliceType.label, color = Color(0xFF3A2A00))
                }
            }
        }
    }
}

@Composable
private fun ModeTile(vm: HomeViewModel) {
    val c = Alice.c
    val modes = Mode.entries
    var w by remember { mutableFloatStateOf(1f) }
    val x by animateFloatAsState(w / modes.size * modes.indexOf(vm.mode), Motion.release(), label = "pill") // the pill slides with the spring
    val radius = with(LocalDensity.current) { 16.dp.toPx() }
    Tile(Modifier.padding(horizontal = 16.dp), c.sageSoft, 8.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                Modifier.onSizeChanged { w = it.width.toFloat() }.drawBehind {
                    drawRoundRect(c.sage, Offset(x, 0f), Size(size.width / modes.size, size.height), CornerRadius(radius))
                },
                horizontalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                modes.forEach { m ->
                    val sel = vm.mode == m
                    val ink by animateColorAsState(if (sel) c.onSage else c.ink2, Motion.ui(), label = "ink")
                    Pressable(Modifier.weight(1f), RoundedCornerShape(16.dp), Color.Transparent, depth = 0.96f, haptic = Haptic.Select, onClick = { vm.chooseMode(m) }) {
                        Column(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Icon(m.icon, null, tint = ink, modifier = Modifier.size(22.dp))
                            Text(m.label, style = AliceType.label, color = ink, maxLines = 1)
                        }
                    }
                }
            }
            vm.suggestion?.let { s ->
                Row(Modifier.padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Rounded.AutoAwesome, null, tint = c.sage, modifier = Modifier.size(16.dp))
                    Text("Switch to ${s.label}? It's getting late.", Modifier.weight(1f), style = AliceType.small, color = c.ink)
                    Pressable(shape = CircleShape, color = c.sage, depth = 0.96f, haptic = Haptic.Select, onClick = { vm.chooseMode(s) }) { Text("Switch", Modifier.padding(horizontal = 14.dp, vertical = 7.dp), style = AliceType.label, color = c.onSage) }
                    Pressable(Modifier.size(32.dp), CircleShape, Color.Transparent, depth = 0.9f, onClick = vm::dismissSuggestion) { Icon(Icons.Rounded.Close, "Not now", tint = c.ink2, modifier = Modifier.align(Alignment.Center).size(16.dp)) }
                }
            }
        }
    }
}

@Composable
private fun DoorsTile(vm: HomeViewModel) {
    val c = Alice.c
    Tile(Modifier.padding(horizontal = 16.dp), c.deep, 10.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { vm.locks.forEach { LockTile(it, Modifier.weight(1f)) { vm.toggleLock(it.id) } } }
            if (vm.locks.any { !it.locked }) Pressable(Modifier.fillMaxWidth(), RoundedCornerShape(16.dp), c.deepInk, haptic = Haptic.Success, onClick = vm::lockAll) {
                Text("Lock everything", Modifier.fillMaxWidth().padding(vertical = 12.dp), style = AliceType.bodyStrong, color = c.deep, textAlign = TextAlign.Center)
            }
        }
    }
}

/** Every scene card has the same parts (icon, name, two lines), so a row of them is always one height; "suggested" is a corner tag, not an extra line. */
@Composable
private fun SceneCard(name: String, desc: String, icon: ImageVector, suggested: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = Alice.c
    Pressable(modifier, color = if (suggested) c.sageSoft else c.tile, depth = 0.98f, haptic = Haptic.Medium, onClick = onClick) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            IconDisc(icon, if (suggested) c.sage else c.tile2, if (suggested) c.onSage else c.ink2)
            Column {
                Text(name, style = AliceType.bodyStrong, color = c.ink, maxLines = 1)
                Text(desc, style = AliceType.small, color = c.ink3, maxLines = 2, minLines = 2)
            }
        }
        if (suggested) Text("SUGGESTED", Modifier.align(Alignment.TopEnd).padding(14.dp), style = AliceType.mono.copy(fontSize = 9.5.sp), color = c.sage)
    }
}

/** An even grid: every row is as tall as its tallest card and the cards share the width, 2 across on a phone and 4 on a wide screen. */
@Composable
private fun <T> Bento(items: List<T>, modifier: Modifier = Modifier, gap: Dp = 10.dp, card: @Composable (T, Modifier) -> Unit) {
    BoxWithConstraints(modifier) {
        val cols = if (maxWidth >= 600.dp) 4 else 2
        Column(verticalArrangement = Arrangement.spacedBy(gap)) {
            items.chunked(cols).forEach { row ->
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    row.forEach { card(it, Modifier.weight(1f).fillMaxHeight()) }
                    repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun ClimateTile(vm: HomeViewModel, modifier: Modifier) {
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
                Stepper(Icons.Rounded.Remove, vm.target > 16) { vm.step(-1) }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("${vm.target}°", style = AliceType.bodyStrong, color = c.ink)
                    Text("target", style = AliceType.small, color = c.ink3)
                }
                Stepper(Icons.Rounded.Add, vm.target < 30) { vm.step(1) }
            }
        }
    }
}

@Composable
private fun Stepper(icon: ImageVector, canMove: Boolean, onClick: () -> Unit) {
    val c = Alice.c
    Pressable(Modifier.size(40.dp), CircleShape, c.over, depth = 0.9f, haptic = if (canMove) Haptic.Tick else Haptic.Boundary, onClick = onClick) { Icon(icon, null, tint = c.ink, modifier = Modifier.align(Alignment.Center).size(20.dp)) }
}

@Composable
private fun EnergyTile(vm: HomeViewModel, modifier: Modifier) {
    val c = Alice.c
    Tile(modifier, c.tile, 14.dp) {
        Column(Modifier.fillMaxHeight(), verticalArrangement = Arrangement.SpaceBetween) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Bolt, null, tint = c.glowInk, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("ENERGY NOW", style = AliceType.mono.copy(fontSize = 10.5.sp), color = c.ink2)
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Text("%.2f".format(vm.kw), style = AliceType.big, color = c.ink)
                Text(" kW", Modifier.padding(bottom = 4.dp), style = AliceType.small, color = c.ink2)
            }
            Sparkline(vm.energy, c.sage, Modifier.fillMaxWidth().height(40.dp))
            Text("Today 11.4 kWh", style = AliceType.small, color = c.ink3)
        }
    }
}

@Composable
private fun Sparkline(values: List<Float>, color: Color, modifier: Modifier) {
    Canvas(modifier) {
        val mx = values.max(); val mn = values.min(); val span = (mx - mn).coerceAtLeast(0.01f)
        val pts = values.mapIndexed { i, v -> Offset(size.width * i / (values.size - 1), size.height - (v - mn) / span * size.height * 0.9f - size.height * 0.05f) }
        val p = Path().apply { moveTo(pts[0].x, pts[0].y); pts.drop(1).forEach { lineTo(it.x, it.y) } }
        drawPath(p, color, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round))
    }
}

@Composable
private fun PeopleRow(vm: HomeViewModel) {
    val c = Alice.c
    Tile(Modifier.padding(horizontal = 16.dp), c.tile, 12.dp) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            vm.people.forEach { p ->
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
private fun ActivityTile(vm: HomeViewModel, open: Boolean, toggle: () -> Unit) {
    val c = Alice.c
    val fresh = vm.activity.count { it.fresh }
    Tile(Modifier.padding(horizontal = 16.dp), c.tile, 0.dp) {
        Column {
            Pressable(Modifier.fillMaxWidth(), color = Color.Transparent, depth = 0.98f, haptic = null, onClick = toggle) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    IconDisc(Icons.Rounded.Notifications, c.tile2, c.ink2)
                    Column(Modifier.weight(1f)) {
                        Text("$fresh new since you were away", style = AliceType.bodyStrong, color = c.ink)
                        Text(vm.activity.first().text, style = AliceType.small, color = c.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Icon(Icons.Rounded.ExpandMore, null, tint = c.ink3)
                }
            }
            AnimatedVisibility(open) {
                Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    vm.activity.forEach { e ->
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

/** The floating glass tab bar (shell.tsx + glass.css): a sliding glass pill under the selected tab, filled icon when selected, labels fold away while reading downward. */
@Composable
private fun GlassTabBar(backdrop: GraphicsLayer, selected: Int, minimized: Boolean, onSelect: (Int) -> Unit, modifier: Modifier) {
    val c = Alice.c
    val items = listOf("Home" to (Icons.Outlined.Home to Icons.Rounded.Home), "Rooms" to (Icons.Outlined.MeetingRoom to Icons.Rounded.MeetingRoom),
        "Automate" to (Icons.Outlined.Tune to Icons.Rounded.Tune), "People" to (Icons.Outlined.Person to Icons.Rounded.Person))
    var w by remember { mutableFloatStateOf(1f) }
    val x by animateFloatAsState(w / items.size * selected, Motion.release(), label = "tab")
    val shape = RoundedCornerShape(26.dp)
    val hi = if (c.dark) Color.White.copy(0.13f) else Color.White.copy(0.72f)
    val radius = with(LocalDensity.current) { 20.dp.toPx() }
    // Height of a tab with its label: icon + 3 dp gap + one label line + the column's 6 dp padding.
    // Pinning the folded row to this keeps the bar from dipping while one label folds and another unfolds,
    // so the only movement left is the wave below.
    val foldedRowMin = 24.dp + 3.dp + with(LocalDensity.current) { AliceType.label.lineHeight.toDp() } + 12.dp
    // In the folded bar a tiny lift travels along the tabs between the old and new selection, like a wave
    // following the pill. Tabs outside that path never move. The lift is drawn, not laid out, so it cannot
    // disturb the bar's measured height.
    val lifts = remember { List(items.size) { Animatable(0f) } }
    var previous by remember { mutableIntStateOf(selected) }
    LaunchedEffect(selected, minimized) {
        val from = previous
        previous = selected
        lifts.forEach { it.snapTo(0f) }
        if (!minimized || from == selected) return@LaunchedEffect
        val path = if (selected > from) (from..selected).toList() else (from downTo selected).toList()
        path.forEachIndexed { order, i ->
            launch {
                delay(order * 45L)
                lifts[i].animateTo(1f, tween(110, easing = Motion.easeOut))
                lifts[i].animateTo(0f, spring(dampingRatio = 0.6f, stiffness = 500f))
            }
        }
    }
    GlassSurface(backdrop, modifier.navigationBarsPadding().padding(start = 12.dp, end = 12.dp, bottom = 10.dp).fillMaxWidth(), shape) {
        Row(
            // centre every item in the tallest one (the selected tab keeps its label while minimised), so the
            // collapsed icons stay on the bar's centre line instead of riding up with the shorter 44 dp column
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(6.dp).heightIn(min = if (minimized) foldedRowMin else 0.dp).animateContentSize(Motion.release()).onSizeChanged { w = it.width.toFloat() }.drawBehind {
                drawRoundRect(hi, Offset(x, 0f), Size(size.width / items.size, size.height), CornerRadius(radius))
                drawRoundRect(Color.White.copy(if (c.dark) 0.08f else 0.5f), Offset(x, 0f), Size(size.width / items.size, size.height), CornerRadius(radius), style = Stroke(1.dp.toPx()))
            },
        ) {
            items.forEachIndexed { i, (label, icons) ->
                val sel = selected == i
                val ink by animateColorAsState(if (sel) c.ink else c.ink3, Motion.ui(), label = "tabink")
                Pressable(Modifier.weight(1f), RoundedCornerShape(20.dp), Color.Transparent, depth = 0.96f, haptic = null, onClick = { onSelect(i) }) {
                    Column(Modifier.fillMaxWidth().heightIn(min = if (minimized) 44.dp else 52.dp).padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Icon(if (sel) icons.second else icons.first, label, tint = ink, modifier = Modifier.size(24.dp).graphicsLayer { translationY = -lifts[i].value * 2.5.dp.toPx() })
                        AnimatedVisibility(!minimized || sel) { Text(label, style = AliceType.label, color = ink, maxLines = 1, modifier = Modifier.padding(top = 3.dp)) }
                    }
                }
            }
        }
    }
}

/** A dark glass pill that springs in above the tab bar and dismisses itself after a moment (toast.css). */
@Composable
private fun GlassToast(text: String?, modifier: Modifier, onDone: () -> Unit) {
    val c = Alice.c
    var shown by remember { mutableStateOf("") }
    if (text != null) shown = text
    LaunchedEffect(text) { if (text != null) { delay(2600); onDone() } }
    AnimatedVisibility(
        text != null, modifier,
        enter = fadeIn(tween(180)) + scaleIn(Motion.release(), initialScale = 0.9f) + slideInVertically(Motion.release()) { it / 2 },
        exit = fadeOut(tween(160, easing = Motion.easeIn)) + slideOutVertically(tween(200, easing = Motion.easeIn)) { it / 3 },
    ) {
        Box(Modifier.clip(CircleShape).background(c.ink.copy(alpha = 0.9f))) {
            Text(shown, Modifier.padding(horizontal = 22.dp, vertical = 14.dp), style = AliceType.bodyStrong, color = c.tile)
        }
    }
}
