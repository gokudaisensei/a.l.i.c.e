@file:OptIn(ExperimentalLayoutApi::class)

package com.alice.home.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alice.home.domain.model.Piece
import com.alice.home.domain.model.Slot
import com.alice.home.ui.Haptic
import com.alice.home.ui.theme.AliceType

/**
 * A sentence you build by tapping it. Plain words are text; each [Piece] that has a [Slot] is a chip: tap it to edit that part. The chip
 * for [active] is filled with [ink] (and its text takes [onInk]), the others sit on [chip]; a piece that starts with "+" is an invitation
 * to add something and is drawn as an outline. Every word and chip is the same height so a wrapping sentence keeps a steady rhythm.
 */
@Composable
fun SentenceFlow(
    pieces: List<Piece>,
    active: Slot?,
    ink: Color,
    onInk: Color,
    chip: Color,
    onSlot: (Slot) -> Unit,
    modifier: Modifier = Modifier,
) {
    val word = AliceType.heroSub.copy(fontSize = 22.sp, lineHeight = 26.sp)
    val token = AliceType.bodyStrong.copy(fontSize = 17.sp, lineHeight = 20.sp)
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        pieces.forEach { p ->
            val slot = p.slot
            if (slot == null) {
                p.text.split(" ").filter { it.isNotEmpty() }.forEach { w ->
                    Box(Modifier.height(38.dp), contentAlignment = Alignment.CenterStart) { Text(w, style = word, color = ink.copy(alpha = 0.92f)) }
                }
            } else {
                val on = slot == active
                val invite = p.text.startsWith("+")
                Pressable(
                    Modifier.height(38.dp).then(if (invite && !on) Modifier.border(1.5.dp, ink.copy(alpha = 0.45f), RoundedCornerShape(14.dp)) else Modifier),
                    RoundedCornerShape(14.dp), if (on) ink else if (invite) Color.Transparent else chip, depth = 0.95f, haptic = Haptic.Select, onClick = { onSlot(slot) },
                ) {
                    Box(Modifier.height(38.dp).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) { Text(p.text, style = token, color = if (on) onInk else ink, maxLines = 1) }
                }
            }
        }
    }
}
