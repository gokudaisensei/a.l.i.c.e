package com.alice.home.ui.people

import com.alice.home.data.HouseholdState

data class PeopleUiState(
    val household: HouseholdState = HouseholdState(),
    /** The member whose card is open (their name), or null while looking at the list. */
    val selected: String? = null,
    /** Removing needs a passkey: true once "Remove" was tapped and the person has not yet confirmed. */
    val confirmRemove: Boolean = false,
    val inviteRole: String = "Member",
    val inviteHours: Int = 24,
    /** The code just made. Shown once; gone when the screen is left or another is made. */
    val newCode: String? = null,
    val focus: String? = null,
    val toast: String? = null,
)
