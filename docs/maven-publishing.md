# Maven Publishing (GitHub Packages)

This lane publishes the Android library
[`moe.gdkirie.kirie:core`](../packages/kirie/native/android/plugin/build.gradle.kts)
to **GitHub Packages** (Maven). It is separate from:

- the Godot addon zip release (local staged AARs under
  `addons/kirie/libraries/android/`)
- npm publishing for browser / CLI packages
- NuGet publishing for .NET hosts

Godot Android exports that use Kirie through the addon continue to consume the
bundled AAR. Maven publishing is for hosts that want to depend on the Android
plugin as a normal Gradle/Maven coordinate.

## Coordinates

| Field | Value |
| --- | --- |
| groupId | `moe.gdkirie.kirie` |
| artifactId | `core` |
| version | same as the release tag without the leading `v` (for example `0.15.0` for `v0.15.0`) |
| repository | `https://maven.pkg.github.com/gd-kirie/gd-kirie` |

`org.godotengine:godot` is a `compileOnly` dependency of the published artifact.
Consumers must already provide a matching Godot Android library (the Godot
export template / custom Android build does this for Godot projects).

## Consume from Gradle

Add the GitHub Packages Maven repository and the dependency. GitHub requires
authenticated reads for Packages, even for public repositories:

```kotlin
repositories {
    maven {
        url = uri("https://maven.pkg.github.com/gd-kirie/gd-kirie")
        credentials {
            username = providers.gradleProperty("gpr.user")
                .orElse(providers.environmentVariable("GITHUB_ACTOR"))
                .get()
            password = providers.gradleProperty("gpr.key")
                .orElse(providers.environmentVariable("GITHUB_TOKEN"))
                .get()
        }
    }
}

dependencies {
    implementation("moe.gdkirie.kirie:core:<version>")
}
```

Suggested credentials:

- `GITHUB_ACTOR` / `gpr.user`: your GitHub username
- `GITHUB_TOKEN` / `gpr.key`: a PAT (or `GITHUB_TOKEN` in Actions) with at least
  `read:packages` (and `repo` when the package or repository is private)

## Local validation

From the repository root, with Java and the Android SDK available (for example
via `mise`):

```sh
packages/kirie/native/android/gradlew \
  --project-dir packages/kirie/native/android \
  :plugin:assembleRelease \
  :plugin:publishReleasePublicationToMavenLocal
```

That installs `moe.gdkirie.kirie:core` into `~/.m2` without touching GitHub
Packages. To publish explicitly to GitHub Packages from a workstation:

```sh
export GITHUB_ACTOR=your-github-username
export GITHUB_TOKEN=ghp_xxx   # needs write:packages (and repo if private)
packages/kirie/native/android/gradlew \
  --project-dir packages/kirie/native/android \
  :plugin:publishReleasePublicationToGitHubPackagesRepository
```

## GitHub Actions publishing

The `Publish Maven Packages` workflow (`.github/workflows/maven-release.yml`)
mirrors the NuGet release lane:

- triggers on pushed `v*` tags and on `workflow_dispatch`
- on tag pushes, checks that the tagged commit is reachable from `main`
- uses `permissions: contents: read` and `packages: write`
- authenticates with the job `GITHUB_TOKEN` (no `CENTRAL_*` / GPG secrets)

After a normal release bump (`mise run release` / bumpp), push the `v*` tag
from a commit on `main`. The workflow builds the release variant and publishes
`moe.gdkirie.kirie:core` to
`https://maven.pkg.github.com/gd-kirie/gd-kirie`.

The Android library version is read at build time from the monorepo root
`package.json` (see `packages/kirie/native/android/plugin/build.gradle.kts`),
so a normal release bump that updates `package.json` is enough—no separate
Gradle version rewrite in `bump.config.ts`.

## Relationship to zip / npm

| Lane | Artifact | Consumer |
| --- | --- | --- |
| Addon zip | `Kirie-release.aar` staged into the Godot addon | Godot projects installing Kirie as an addon |
| npm | `@gd-kirie/*`, `kirie` | Browser / CLI / tooling |
| NuGet | `GdKirie.*` | .NET / Godot C# hosts |
| Maven (this lane) | `moe.gdkirie.kirie:core` | Gradle/Maven Android hosts that pull the plugin from GitHub Packages |

Publishing to Maven does not remove the addon-bundled AAR path.

## References

- [Working with the Apache Maven registry](https://docs.github.com/packages/working-with-a-github-packages-registry/working-with-the-apache-maven-registry)
- [Gradle maven-publish plugin](https://docs.gradle.org/current/userguide/publishing_maven.html)
- [Android library publishing](https://developer.android.com/build/publish-library)
