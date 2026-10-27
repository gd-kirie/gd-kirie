import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("maven-publish")
}

group = "ai.moeru.kirie"

// Keep Maven publication version in sync with the monorepo root package.json
// (bumpp updates that file; do not hardcode a second source of truth here).
fun readMonorepoVersion(): String {
    val packageJson = rootProject.projectDir.resolve("../../../../package.json")
    require(packageJson.isFile) {
        "Missing monorepo package.json at ${packageJson.normalize()}"
    }
    val match = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
        .find(packageJson.readText())
        ?: error("version field not found in ${packageJson.normalize()}")
    return match.groupValues[1]
}

version = readMonorepoVersion()

val pluginName = "Kirie"
val pluginPackageName = "ai.moeru.kirie.android"

android {
    namespace = pluginPackageName
    compileSdk = 36

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        minSdk = 24

        manifestPlaceholders["godotPluginName"] = pluginName
        manifestPlaceholders["godotPluginPackageName"] = pluginPackageName
        manifestPlaceholders["kirieUsesCleartextTraffic"] = "false"
        buildConfigField("String", "GODOT_PLUGIN_NAME", "\"$pluginName\"")
        setProperty("archivesBaseName", pluginName)
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        debug {
            manifestPlaceholders["kirieUsesCleartextTraffic"] = "true"
        }

        release {
            manifestPlaceholders["kirieUsesCleartextTraffic"] = "false"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
        }
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.16.0")
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-cbor:2.21.3")
    // Provided by the Godot Android export / host app; keep out of the published POM.
    compileOnly("org.godotengine:godot:4.7.2.stable")
}

publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "ai.moeru.kirie"
            artifactId = "core"
            version = project.version.toString()

            afterEvaluate {
                from(components["release"])
            }

            pom {
                name.set("Kirie Android Core")
                description.set(
                    "Android WebView Godot plugin core for Kirie " +
                        "(embedding platform WebViews in Godot).",
                )
                url.set("https://github.com/gd-kirie/gd-kirie")
                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
                developers {
                    developer {
                        name.set("Moeru AI")
                        organization.set("Moeru AI")
                        organizationUrl.set("https://github.com/moeru-ai")
                    }
                }
                scm {
                    connection.set("scm:git:https://github.com/gd-kirie/gd-kirie.git")
                    developerConnection.set("scm:git:ssh://git@github.com/gd-kirie/gd-kirie.git")
                    url.set("https://github.com/gd-kirie/gd-kirie")
                }
            }
        }
    }

    repositories {
        maven {
            name = "GitHubPackages"
            url = uri("https://maven.pkg.github.com/gd-kirie/gd-kirie")
            credentials {
                username = project.findProperty("gpr.user") as String?
                    ?: System.getenv("GITHUB_ACTOR")
                password = project.findProperty("gpr.key") as String?
                    ?: System.getenv("GITHUB_TOKEN")
            }
        }
    }
}
