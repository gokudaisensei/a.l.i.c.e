package com.alice.home.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Icon
import com.alice.home.ui.Haptic
import com.alice.home.ui.LocalHaptics
import com.alice.home.ui.theme.Alice
import kotlin.math.ceil
import kotlin.math.floor

/**
 * Where a tile can be pulled from: the middle of its right or left edge, the middle of its bottom edge, or a bottom corner. A tile that
 * touches the right edge of the screen is widened from the left instead (there is nowhere to drag a right-hand dot to).
 */
enum class ResizeHandle { Right, Left, Bottom, Corner, CornerLeft }

/**
 * A card is 1×1, 1 wide by 2 tall, or 2×2: two columns always means two rows. So only the handles that lead somewhere are offered:
 * a 1×1 can be pulled down (to 1×2) or by the corner (to 2×2); a 1×2 can go back up, or wider; a 2×2 can narrow, or shrink by the corner.
 * [atRightEdge] swaps the right-hand handles for left-hand ones.
 */
internal fun DeviceCardSize.handles(atRightEdge: Boolean): List<ResizeHandle> {
    val side = if (atRightEdge) ResizeHandle.Left else ResizeHandle.Right
    val corner = if (atRightEdge) ResizeHandle.CornerLeft else ResizeHandle.Corner
    return when (this) {
        DeviceCardSize.Small -> listOf(ResizeHandle.Bottom, corner)
        DeviceCardSize.Tall -> listOf(side, ResizeHandle.Bottom, corner)
        DeviceCardSize.Large -> listOf(side, corner)
    }
}

/**
 * Where pulling [handle] by ([dxCells], [dyCells]) (in cells, signed, screen direction) lands, starting from [base]. A little over a third of
 * a cell is enough to snap to the next one. A left-hand handle widens when pulled left. A 2×1 does not exist, so it reads as 2×2.
 */
internal fun resolveSize(base: DeviceCardSize, handle: ResizeHandle, dxCells: Float, dyCells: Float): DeviceCardSize {
    fun snap(v: Float) = if (v >= 0f) floor(v + 0.6f).toInt() else ceil(v - 0.6f).toInt()
    val wide = when (handle) { ResizeHandle.Right, ResizeHandle.Corner -> dxCells; ResizeHandle.Left, ResizeHandle.CornerLeft -> -dxCells; ResizeHandle.Bottom -> 0f }
    val tall = if (handle == ResizeHandle.Right || handle == ResizeHandle.Left) 0f else dyCells
    val cols = (base.colSpan + snap(wide)).coerceIn(1, 2)
    val rows = (base.rowSpan + snap(tall)).coerceIn(1, 2)
    return when { cols == 2 -> DeviceCardSize.Large; rows == 2 -> DeviceCardSize.Tall; else -> DeviceCardSize.Small }
}

/** How far the frame reaches past the tile on every side, so a dot on the outline can be grabbed from just outside it too. */
val FrameMargin = 10.dp
private val DotSize = 10.dp
private val OutlineWidth = 2.dp

/**
 * Wraps a tile and, while arranging, lays over it what a widget has on an Android home screen: an outline, and on the selected tile
 * small filled dots on the edges that can be dragged. Tap a tile to select it; drag a dot the way the tile should grow (or back the way it
 * should shrink) and the tile follows, snapping to a cell each time the finger passes a third of the way there, with a tick for each snap.
 *
 * The dots are centred on the outline's stroke. The frame is [FrameMargin] larger than the tile on every side, with the tile inset, so a
 * touch just outside the outline still lands on a dot (a touch outside a view's bounds would never arrive). [visible] is 0 to 1 so the
 * outline can fade in while the arrange pull is still under the finger. [stepX] and [stepY] are one cell plus the gap, in pixels. The dragged
 * distance is summed from the finger's own movement, never read from where the dot is, because the dot moves when the tile grows.
 */
@Composable
fun ResizeFrame(
    size: DeviceCardSize,
    selected: Boolean,
    visible: Float,
    stepX: Float,
    stepY: Float,
    atRightEdge: Boolean,
    onSelect: () -> Unit,
    onResize: (DeviceCardSize) -> Unit,
    onDelete: () -> Unit = {},
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val c = Alice.c
    val haptics = LocalHaptics.current
    val sizeNow by rememberUpdatedState(size)
    val resizeNow by rememberUpdatedState(onResize)
    val selectNow by rememberUpdatedState(onSelect)
    val sx by rememberUpdatedState(stepX)
    val sy by rememberUpdatedState(stepY)
    // the handle being dragged stays on screen even if the tile's new size would not offer it, or the drag would be dropped
    var active by remember { mutableStateOf<ResizeHandle?>(null) }
    Box(modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().padding(FrameMargin)) {
            content()
            if (visible > 0f) Box(
                Modifier.fillMaxSize().graphicsLayer { alpha = visible }
                    .border(OutlineWidth, if (selected) c.glow else c.ink3.copy(alpha = 0.5f), TileShape)
                    .pointerInput(Unit) { detectTapGestures { haptics.play(Haptic.Select); selectNow() } },
            )
        }
        if (visible > 0.99f) {
        Box(
            Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 2.dp).size(24.dp).clip(CircleShape)
                .background(c.crit).clickable { onDelete() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Close, contentDescription = "Remove from favourites", tint = c.onSage, modifier = Modifier.size(14.dp))
        }
    }
    if (selected && visible > 0f) (size.handles(atRightEdge) + listOfNotNull(active)).distinct().forEach { h ->
            // each handle keeps its identity when the others come and go as the tile changes size, or the drag in progress would be dropped
            key(h) {
                val align = when (h) { ResizeHandle.Right -> Alignment.CenterEnd; ResizeHandle.Left -> Alignment.CenterStart; ResizeHandle.Bottom -> Alignment.BottomCenter; ResizeHandle.Corner -> Alignment.BottomEnd; ResizeHandle.CornerLeft -> Alignment.BottomStart }
                // a 44dp hit area reaching 10dp outside the outline; the dot is drawn at its edge, centred on the outline's stroke
                Box(
                    Modifier.align(align).size(44.dp).pointerInput(h) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            down.consume() // the page must not take this touch for a scroll
                            active = h
                            val base = sizeNow
                            var total = Offset.Zero
                            var last = base
                            while (true) {
                                val ev = awaitPointerEvent()
                                val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                                if (ch.changedToUp()) break
                                total += ch.positionChange()
                                ch.consume()
                                val next = resolveSize(base, h, total.x / sx, total.y / sy)
                                if (next != last) { last = next; haptics.play(Haptic.Detent); resizeNow(next) }
                            }
                            active = null
                        }
                    },
                ) {
                    // The outline's centre line is half a stroke inside the tile's edge, which is FrameMargin inside the frame's edge. At a
                    // corner the outline is an arc, not the box's corner: its centre line passes R - (R - w/2)·cos 45° inside both edges.
                    val corner = h == ResizeHandle.Corner || h == ResizeHandle.CornerLeft
                    val along = FrameMargin + OutlineWidth / 2 - DotSize / 2
                    val atCorner = FrameMargin + (TileRadius - (TileRadius - OutlineWidth / 2) * 0.7071f) - DotSize / 2
                    val inset = if (corner) atCorner else along
                    val a = align
                    val left = h == ResizeHandle.Left || h == ResizeHandle.CornerLeft
                    val dx = if (h == ResizeHandle.Bottom) 0.dp else if (left) inset else -inset
                    val dy = if (h == ResizeHandle.Right || h == ResizeHandle.Left) 0.dp else -inset
                    Box(Modifier.align(a).offset(x = dx, y = dy).size(DotSize).clip(CircleShape).background(c.glow))
                }
            }
        }
    }
}
