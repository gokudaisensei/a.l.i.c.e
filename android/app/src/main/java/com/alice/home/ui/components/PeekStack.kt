package com.alice.home.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alice.home.ui.theme.Alice
import com.alice.home.ui.theme.AliceType

/** One thing in a [PeekStack]: an icon, or a single letter (a brand's monogram). */
data class Peek(val icon: ImageVector? = null, val letter: String? = null)

/**
 * A small overlapping stack of discs that previews what is inside a folded group (the kinds of device in a room, the brands in a type),
 * with a "+N" disc when there are more than [max]. It is what a closed header shows instead of leaving you to open it to find out.
 */
@Composable
fun PeekStack(items: List<Peek>, modifier: Modifier = Modifier, max: Int = 4, size: androidx.compose.ui.unit.Dp = 26.dp) {
    val c = Alice.c
    if (items.isEmpty()) return
    val shown = items.take(max)
    val extra = items.size - shown.size
    val step = size - 8.dp
    val count = shown.size + if (extra > 0) 1 else 0
    Box(modifier.width(step * (count - 1) + size).size(size)) {
        shown.forEachIndexed { i, p ->
            Box(Modifier.offset(x = step * i).size(size).clip(CircleShape).background(c.tile2).border(2.dp, c.bg, CircleShape), contentAlignment = Alignment.Center) {
                if (p.icon != null) Icon(p.icon, null, tint = c.ink2, modifier = Modifier.size(size * 0.5f))
                else Text(p.letter.orEmpty(), style = AliceType.label.copy(fontSize = (size.value * 0.42f).sp, lineHeight = (size.value * 0.42f).sp), color = c.ink2)
            }
        }
        if (extra > 0) Box(Modifier.offset(x = step * shown.size).size(size).clip(CircleShape).background(c.tile2).border(2.dp, c.bg, CircleShape), contentAlignment = Alignment.Center) {
            Text("+$extra", style = AliceType.mono.copy(fontSize = (size.value * 0.38f).sp), color = c.ink3)
        }
    }
}
