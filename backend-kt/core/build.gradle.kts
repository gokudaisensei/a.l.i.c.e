plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.sqldelight)
}

dependencies {
    api(libs.kotlinx.coroutines.core)
    api(libs.kotlinx.serialization.json)
    api(libs.slf4j.api)
    api(libs.sqldelight.runtime)

    implementation(libs.koin.core)
    implementation(libs.sqldelight.sqlite.driver)
    implementation(libs.sqlite.jdbc)
    implementation(libs.hoplite.yaml)
    implementation(libs.ulid.creator)

    testImplementation(kotlin("test"))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.logback.classic)
}

sqldelight {
    databases {
        create("AliceDb") {
            packageName.set("alice.core.db")
            // SQLite 3.38 so the schema may use UPSERT (3.24+) and STRICT-free
            // modern syntax. The bundled driver is newer than this, so the
            // dialect only constrains what SQLDelight accepts at compile time.
            dialect(libs.sqldelight.sqlite.dialect)
        }
    }
}
