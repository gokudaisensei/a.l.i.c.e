package com.alice.home.domain.model

/**
 * Household entities. These are plain data: no Compose types, no JSON. Icons travel as keys
 * (`"sun"`, `"moon"`, `"exit"`, `"play"`, …) so the same vocabulary works for the mock, the
 * backend and any other client; the UI maps a key to a glyph.
 */

enum class Mode(val label: String) { Home("Home"), Away("Away"), Night("Night"), Vacation("Vacation") }

data class Lock(val id: String, val name: String, val locked: Boolean, val by: String)

data class Scene(val id: String, val name: String, val description: String, val icon: String)

/** A member of the household. The name doubles as the id for now (D25). [endsAt] is set for a guest whose access runs out. */
data class Person(val name: String, val home: Boolean, val role: String, val me: Boolean = false, val endsAt: String? = null,
    /** The devices this person may use, by id; null means all of them. Admins always have all. */
    val devices: Set<String>? = null)

/** A one-time code waiting to be used. The code itself is shown once, when it is made, and never stored. */
data class Invite(val id: String, val role: String, val expires: String)

data class Event(val text: String, val time: String, val fresh: Boolean)
