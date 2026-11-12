package com.alice.home.domain.model

import java.time.LocalTime

enum class Tod { Morning, Day, Evening, Night }

fun tod(h: Int = LocalTime.now().hour) = when (h) {
    in 5..10 -> Tod.Morning; in 11..16 -> Tod.Day; in 17..20 -> Tod.Evening; else -> Tod.Night
}
