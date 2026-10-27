import com.vanniktech.maven.publish.AndroidSingleVariantLibrary
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("com.vanniktech.maven.publish")
}

group = "moe.gdkirie.kirie"

// Keep Maven publication version in sync with the monorepo root package.json
// (bumpp updates that file; do not hardcode a second source of truth here).
fun readMonorepoVersion(): String {
    val packageJson = rootProject.projectDir.resolve("../../../../package.json")
    val path = packageJson.normalize()
    if (!packageJson.isFile) {
        error("Missing monorepo package.json at $path")
    }
    val parsed = try {
        groovy.json.JsonSlurper().parse(packageJson)
    } catch (e: Exception) {
        error("Failed to parse JSON in $path: ${e.message}")
    }
    val root = parsed as? Map<*, *>
        ?: error("Expected a JSON object at top level of $path")
    val version = root["version"]
        ?: error("Missing top-level \"version\" field in $path")
    if (version !is String || version.isBlank()) {
        error("Top-level \"version\" in $path must be a non-empty string, got: $version")
    }
    return version
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

}

dependencies {
    implementation("androidx.webkit:webkit:1.16.0")
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-cbor:2.21.3")
    // Provided by the Godot Android export / host app; keep out of the published POM.
    compileOnly("org.godotengine:godot:4.7.2.stable")
}

// Published to Maven Central via the Central Publisher Portal
// (https://central.sonatype.com). Credentials and signing key come from
// Gradle properties / ORG_GRADLE_PROJECT_* env vars, see docs/maven-publishing.md:
//   mavenCentralUsername / mavenCentralPassword   (Portal user token)
//   signingInMemoryKey / signingInMemoryKeyId / signingInMemoryKeyPassword (GPG)
mavenPublishing {
    coordinates("moe.gdkirie.kirie", "core", project.version.toString())

    configure(
        AndroidSingleVariantLibrary(
            variant = "release",
            sourcesJar = true,
            publishJavadocJar = true,
        ),
    )

    publishToMavenCentral(automaticRelease = true)

    // Central requires signatures; skip signing for local publishToMavenLocal
    // runs when no key is configured.
    if (providers.gradleProperty("signingInMemoryKey").isPresent) {
        signAllPublications()
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
                id.set("moeru-ai")
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
