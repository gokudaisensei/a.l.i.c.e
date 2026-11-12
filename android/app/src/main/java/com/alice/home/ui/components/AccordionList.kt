package com.alice.home.ui.components

import androidx.compose.animation.core.AnimationState
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.exponentialDecay
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.FlingBehavior
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.ScrollScope
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.alice.home.ui.Haptic
import com.alice.home.ui.LocalHaptics
import com.alice.home.ui.theme.Alice
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.max
import kotlin.math.roundToInt

/** One category in an [AccordionList]: its header (title, hint, an optional peek of what is inside) and its body. */
class AccordionPane(
    val key: String,
    val title: String,
    val hint: String?,
    val peek: (@Composable () -> Unit)?,
    val content: @Composable () -> Unit,
)

/**
 * A list whose scrolling opens and closes its categories, instead of moving the page. The list area itself does not scroll like a page: a
 * drag inside it turns a single number, the *position* (0 is the first category, 1 the second, and so on), and each category is open in
 * proportion to how close the position is to it. So between two categories one is closing exactly as the other opens, in step with the
 * finger; on release it settles on the nearest one (or the next one, if flicked). Tapping a header jumps to it.
 *
 * An open category always shows its full height. If that is taller than the area, the drag first scrolls the whole list until the end of
 * that category is in view (and, going back, until its start is), and only the movement left over turns the position: so a long category
 * is read to its end before the next one opens, and going back up arrives at the previous one at its end. A category that fits never
 * scrolls; it just hands the drag on.
 *
 * Nothing above the list moves, and no item's place depends on a page scroll offset. [bottomInset] keeps the last header clear of the tab
 * bar; [onFocus] reports the category the list settled on.
 */
@Composable
fun AccordionList(
    panes: List<AccordionPane>,
    focusKey: String?,
    onFocus: (String) -> Unit,
    modifier: Modifier = Modifier,
    bottomInset: Dp = 0.dp,
    headerHeight: Dp = 44.dp,
) {
    val c = Alice.c
    val density = LocalDensity.current
    val haptics = LocalHaptics.current
    val scope = rememberCoroutineScope()
    val n = panes.size
    if (n == 0) return
    val keys = panes.map { it.key }
    val last = (n - 1).toFloat()
    var p by remember(keys) { mutableFloatStateOf(keys.indexOf(focusKey).coerceAtLeast(0).toFloat()) }
    var lastIdx by remember(keys) { mutableIntStateOf(p.roundToInt()) }
    // how far each category's own content is scrolled (only a category taller than the area uses it); observable, because it moves the list
    val offs = remember(keys) { List(n) { mutableFloatStateOf(0f) } }
    // the measured natural height of each category's card and the sizes it was laid out in: written by layout, read only when a drag arrives
    val geo = remember(keys) { Geometry(n) }
    val stride = with(density) { FINGER_TRAVEL_PER_CATEGORY.toPx() }
    val onFocusNow by rememberUpdatedState(onFocus)

    /** How far category [i], fully open, can scroll: its content plus every header, minus what fits in the area. */
    fun maxOff(i: Int) = max(0f, n * geo.header + geo.natural[i] - geo.viewport)
    /** Entering a category from above starts at its top; entering it from below starts at its end. */
    fun enter(i: Int, fromBelow: Boolean) { offs[i].floatValue = if (fromBelow) maxOff(i) else 0f }

    suspend fun settle(to: Float) {
        val from = p.roundToInt()
        val target = to.roundToInt()
        if (target != from) enter(target, fromBelow = target < from)
        animate(p, to, animationSpec = spring(dampingRatio = 0.85f, stiffness = 320f)) { v, _ -> p = v }
        lastIdx = target
        onFocusNow(keys[target])
    }

    val scrollState = rememberScrollableState { delta ->
        val cur = p.roundToInt().coerceIn(0, n - 1)
        val atRest = abs(p - cur) < 0.02f
        var rest = delta
        if (atRest) { // a category that is open and taller than the area reads first
            val o = offs[cur]
            val mx = maxOff(cur)
            if (rest > 0f && o.floatValue < mx) { val take = min(rest, mx - o.floatValue); o.floatValue += take; rest -= take }
            else if (rest < 0f && o.floatValue > 0f) { val take = max(rest, -o.floatValue); o.floatValue += take; rest -= take }
        }
        var moved = 0f
        if (rest != 0f) {
            val old = p
            p = (old + rest / stride).coerceIn(0f, last)
            moved = (p - old) * stride
            val idx = p.roundToInt()
            if (idx != lastIdx) { enter(idx, fromBelow = idx < lastIdx); lastIdx = idx; haptics.play(Haptic.Detent) } // a click as the nearer category changes
        }
        (delta - rest) + moved
    }
    val fling = remember(keys) {
        object : FlingBehavior {
            override suspend fun ScrollScope.performFling(initialVelocity: Float): Float {
                val cur = p.roundToInt().coerceIn(0, n - 1)
                val atRest = abs(p - cur) < 0.02f
                val mx = maxOff(cur)
                val o = offs[cur]
                if (atRest && mx > 0f && abs(initialVelocity) > 300f) {
                    // momentum inside a tall category, stopping at its start or end (a second drag moves on from there)
                    val atEnd = o.floatValue >= mx - 1f; val atStart = o.floatValue <= 1f
                    if (!((initialVelocity > 0 && atEnd) || (initialVelocity < 0 && atStart))) {
                        AnimationState(o.floatValue, initialVelocity).animateDecay(exponentialDecay()) {
                            val clamped = value.coerceIn(0f, mx)
                            o.floatValue = clamped
                            if (clamped != value) cancelAnimation()
                        }
                        return 0f
                    }
                }
                // otherwise settle the position: the next/previous category on a flick (from a category's edge), else the nearest one
                val edgeFwd = !atRest || mx == 0f || o.floatValue >= mx - 1f
                val edgeBack = !atRest || mx == 0f || o.floatValue <= 1f
                val target = when {
                    initialVelocity > 900f && edgeFwd -> ceil(p).let { if (atRest) cur + 1f else it }
                    initialVelocity < -900f && edgeBack -> floor(p).let { if (atRest) cur - 1f else it }
                    else -> p.roundToInt().toFloat()
                }
                settle(target.coerceIn(0f, last))
                return 0f
            }
        }
    }

    BoxWithConstraints(modifier.clipToBounds()) {
        // Every header must stay on screen with about 200dp left for the open category, so with many categories the headers give up some
        // height, between 34dp and the requested one. A category taller than what is left scrolls.
        val spare = maxHeight - bottomInset - 14.dp - 200.dp
        val hh = (spare / n).coerceIn(34.dp, headerHeight)
        geo.header = with(density) { hh.toPx() }
        geo.viewport = with(density) { (maxHeight - bottomInset).toPx() }
        Box(Modifier.fillMaxSize().scrollable(scrollState, Orientation.Vertical, flingBehavior = fling, reverseDirection = true)) {
            Column(
                Modifier.fillMaxWidth().wrapContentHeight(Alignment.Top, unbounded = true).padding(bottom = bottomInset).graphicsLayer {
                    // each category's own scroll counts in proportion to how open it is, so it eases in and out with the position
                    var e = 0f
                    for (i in 0 until n) e += offs[i].floatValue * (1f - abs(p - i)).coerceIn(0f, 1f)
                    translationY = -e
                },
            ) {
                panes.forEachIndexed { i, pane ->
                    val openness: () -> Float = { (1f - abs(p - i)).coerceIn(0f, 1f) }
                    SectionHeader(
                        pane.title, pane.hint, peek = pane.peek, openness = openness, minHeight = hh,
                        onToggle = { haptics.play(Haptic.Select); scope.launch { settle(i.toFloat()) } },
                    )
                    Box(
                        // order matters: the clip and the fade wrap the layout below, so they follow its shrinking height, not the full one
                        Modifier
                            .clipToBounds().graphicsLayer { alpha = openness() }
                            .layout { measurable, cons ->
                                val placeable = measurable.measure(cons.copy(minHeight = 0, maxHeight = Constraints.Infinity))
                                geo.natural[i] = placeable.height.toFloat()
                                val h = (placeable.height * openness()).roundToInt()
                                layout(placeable.width, h) { placeable.place(0, 0) }
                            },
                    ) {
                        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 10.dp)) {
                            Tile(Modifier, c.tile, 0.dp) { Column { pane.content() } }
                        }
                    }
                }
            }
        }
    }
}

/** Finger travel that moves the list from one category to the next: small enough that a short drag is felt, large enough not to flicker. */
private val FINGER_TRAVEL_PER_CATEGORY = 120.dp

/** Sizes written by layout and read when a drag arrives. Deliberately not observable: writing observable state during layout would loop. */
private class Geometry(n: Int) {
    var header = 0f
    var viewport = 0f
    val natural = FloatArray(n)
}
