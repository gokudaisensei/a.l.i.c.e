plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    application
}

dependencies {
    implementation(project(":core"))
    implementation(project(":ha"))

    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.cio)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.server.status.pages)
    implementation(libs.ktor.server.call.logging)
    implementation(libs.ktor.server.websockets)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.yubico.webauthn)
    implementation(libs.koin.core)
    implementation(libs.logback.classic)
    implementation(libs.interaso.webpush)

    testImplementation(kotlin("test"))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.ktor.server.test.host)
    testImplementation(libs.kotlinx.coroutines.test)
}

application {
    mainClass.set("alice.server.MainKt")
}

// `./gradlew :server:run` must resolve relative paths (data/alice.db) against
// the repository root, not the subproject directory, so the server and the
// config worker open the same SQLite file. The packaged distribution keeps the
// conventional "working directory of the launch process" behaviour.
tasks.named<JavaExec>("run") {
    workingDir = rootProject.projectDir
}
