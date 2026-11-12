package com.alice.home.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.MeetingRoom
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.MeetingRoom
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.LocalHaptics
import com.alice.home.ui.Motion
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** One tab: a label and the outlined / filled pair it swaps between. */
data class TabItem(val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

private val DefaultTabs = listOf(
    TabItem("Home", Icons.Outlined.Home, Icons.Rounded.Home),
    TabItem("Rooms", Icons.Outlined.MeetingRoom, Icons.Rounded.MeetingRoom),
    TabItem("Automate", Icons.Outlined.Tune, Icons.Rounded.Tune),
    TabItem("People", Icons.Outlined.Person, Icons.Rounded.Person),
)

/**
 * The floating glass tab bar (shell.tsx + glass.css): a sliding glass pill under the selected tab, filled icon when selected,
 * labels fold away while reading downward.
 */
@Composable
fun GlassTabBar(
    backdrop: GraphicsLayer,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    items: List<TabItem> = DefaultTabs,
    minimized: Boolean = false,
) {
    val c = Alice.c
    val haptics = LocalHaptics.current
    // Measure the row's real width before animating the pill. Starting from 1f (as before) made the pill's
    // first frame sit at the home tab and then slide to the selected one every time this bar was created —
    // which is exactly what happened on every tab switch, since each screen owns its own bar.
    var w by remember { mutableFloatStateOf(0f) }
    val x = remember { Animatable(0f) }
    var measured by remember { mutableStateOf(false) }
    LaunchedEffect(w, selected) {
        val target = if (w > 0f && items.isNotEmpty()) w / items.size * selected else 0f
        if (w > 0f) {
            if (!measured) {
                x.snapTo(target)
                measured = true
            } else {
                x.animateTo(target, Motion.release())
            }
        }
    }
    val selectedState = rememberUpdatedState(selected)
    val onSelectState = rememberUpdatedState(onSelect)
    var dragTotal by remember { mutableFloatStateOf(0f) }
    var switched by remember { mutableStateOf(false) }

    val shape = RoundedCornerShape(26.dp)
    val hi = if (c.dark) Color.White.copy(0.13f) else Color.White.copy(0.72f)
    val edge = Color.White.copy(if (c.dark) 0.08f else 0.5f)
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
    GlassSurface(backdrop, modifier.navigationBarsPadding().padding(start = 12.dp, end = 12.dp, bottom = 10.dp).fillMaxWidth().pointerInput(Unit) {
        detectHorizontalDragGestures(
            onDragStart = { dragTotal = 0f; switched = false },
            onHorizontalDrag = { change, dragAmount ->
                change.consume()
                if (switched) return@detectHorizontalDragGestures
                dragTotal += dragAmount
                val sel = selectedState.value
                if (dragTotal > 60f) {
                    val target = (sel + 1).coerceAtMost(items.size - 1)
                    if (target != sel) onSelectState.value(target)
                    switched = true
                } else if (dragTotal < -60f) {
                    val target = (sel - 1).coerceAtLeast(0)
                    if (target != sel) onSelectState.value(target)
                    switched = true
                }
            },
        )
    }, shape) {
        Row(
            // centre every item in the tallest one (the selected tab keeps its label while minimised), so the
            // collapsed icons stay on the bar's centre line instead of riding up with the shorter 44 dp column
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(6.dp).heightIn(min = if (minimized) foldedRowMin else 0.dp)
                .animateContentSize(Motion.release()).onSizeChanged { w = it.width.toFloat() }
                .then(if (w > 0f) Modifier.slidingPill(items.size, x.value, 20.dp, hi, border = edge) else Modifier),
        ) {
            items.forEachIndexed { i, item ->
                val sel = selected == i
                val ink by animateColorAsState(if (sel) c.ink else c.ink3, Motion.ui(), label = "tabink")
                Pressable(Modifier.weight(1f), RoundedCornerShape(20.dp), Color.Transparent, depth = 0.96f, haptic = null, onClick = { onSelect(i) }) {
                    Column(Modifier.fillMaxWidth().heightIn(min = if (minimized) 44.dp else 52.dp).padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Icon(if (sel) item.selectedIcon else item.icon, item.label, tint = ink, modifier = Modifier.size(24.dp).graphicsLayer { translationY = -lifts[i].value * 2.5.dp.toPx() })
                        AnimatedVisibility(!minimized || sel) { Text(item.label, style = AliceType.label, color = ink, maxLines = 1, modifier = Modifier.padding(top = 3.dp)) }
                    }
                }
            }
        }
    }
}
