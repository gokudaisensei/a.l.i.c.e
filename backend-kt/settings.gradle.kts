pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "alice-backend"

// Dependency rule (mirrors the TypeScript backend):
//   core  <- depends on nothing
//   ha    <- depends on core
//   server, worker <- depend on core (+ ha)
include(":core", ":ha", ":server", ":worker")
