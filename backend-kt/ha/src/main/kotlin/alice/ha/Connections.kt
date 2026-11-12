package alice.ha

/**
 * The connection id used throughout the app.
 *
 * Alice serves one Home Assistant per household, and every stored row and every thing id is keyed by this value.
 * Thing ids are a hash of `"<connection id>:<ref>"`, so changing it renames every thing and breaks saved favorites,
 * group members, overrides and any client that kept an id. The TypeScript backend this port is checked against uses
 * the same value. Change it only together with a data migration and a client plan.
 */
object Connections {
    const val DEFAULT_ID = "conn-1"
}
