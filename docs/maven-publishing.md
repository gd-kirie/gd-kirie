# Maven Publishing (Maven Central)

This lane publishes the Android library
[`moe.gdkirie.kirie:core`](../packages/kirie/native/android/plugin/build.gradle.kts)
to **Maven Central** through the
[Central Publisher Portal](https://central.sonatype.com) (the legacy OSSRH
service is shut down and is not used). It is separate from:

- the Godot addon zip release (local staged AARs under
  `addons/kirie/libraries/android/`)
- npm publishing for browser / CLI packages
- NuGet publishing for .NET hosts

Godot Android exports that use Kirie through the addon continue to consume the
bundled AAR. Maven publishing is for hosts that want to depend on the Android
plugin as a normal Gradle/Maven coordinate.

GitHub Packages is **no longer used** for this artifact.

## Coordinates

| Field | Value |
| --- | --- |
| groupId | `moe.gdkirie.kirie` (namespace `moe.gdkirie`, verified via `gdkirie.moe`) |
| artifactId | `core` |
| version | top-level `version` of the monorepo root `package.json` (same as the release tag without the leading `v`) |
| repository | Maven Central (`mavenCentral()`) |

`org.godotengine:godot` is a `compileOnly` dependency of the published artifact.
Consumers must already provide a matching Godot Android library (the Godot
export template / custom Android build does this for Godot projects).

## Consume from Gradle

No credentials are needed:

```kotlin
repositories {
    mavenCentral()
}

dependencies {
    implementation("moe.gdkirie.kirie:core:<version>")
}
```

## How publishing is wired

`plugin/build.gradle.kts` uses the
[`com.vanniktech.maven.publish`](https://vanniktech.github.io/gradle-maven-publish-plugin/central/)
Gradle plugin, which:

- publishes the `release` variant AAR plus `-sources.jar` and `-javadoc.jar`
- writes a POM with name, description, URL, MIT license, developer and SCM
  (all required by [Central](https://central.sonatype.org/publish/requirements/))
- signs every artifact with GPG (`.asc`) when a signing key is configured
- uploads a bundle to the Portal API and, with `automaticRelease = true`,
  releases it once validation passes

The version is read at build time from the monorepo root `package.json` with
`groovy.json.JsonSlurper`, so a normal release bump (bumpp) is enough.

## Required secrets (GitHub Actions)

Configure these as **repository Actions secrets**:

| Secret | Gradle property | What it is |
| --- | --- | --- |
| `CENTRAL_USERNAME` | `mavenCentralUsername` | Username part of a Portal **user token** (central.sonatype.com → Account → Generate User Token) |
| `CENTRAL_PASSWORD` | `mavenCentralPassword` | Password part of that user token |
| `SIGNING_KEY` | `signingInMemoryKey` | ASCII-armored GPG **private** key (`gpg --armor --export-secret-keys <KEYID>`) |
| `SIGNING_KEY_ID` | `signingInMemoryKeyId` | Optional: last 8 hex chars of the key ID (needed only if the armored export contains subkeys and you want a specific one) |
| `SIGNING_KEY_PASSWORD` | `signingInMemoryKeyPassword` | Passphrase of the GPG key |

The matching GPG **public** key must be uploaded to a public keyserver that
Central checks (for example `keyserver.ubuntu.com` or `keys.openpgp.org`):

```sh
gpg --keyserver keyserver.ubuntu.com --send-keys <KEYID>
```

The workflow fails early with a clear error if any required secret is missing.

## Releasing

The `Publish Maven Central` workflow (`.github/workflows/maven-release.yml`)
mirrors the NuGet release lane:

- triggers on pushed `v*` tags and on `workflow_dispatch`
- on tag pushes, checks that the tagged commit is reachable from `main`
- runs `:plugin:publishAndReleaseToMavenCentral`

After a normal release bump (`mise run release` / bumpp), push the `v*` tag
from a commit on `main`. Central artifacts are immutable: a version can be
published only once.

## Local validation

From the repository root, with Java and the Android SDK available (for example
via `mise`):

```sh
packages/kirie/native/android/gradlew \
  --project-dir packages/kirie/native/android \
  :plugin:publishToMavenLocal
```

That installs `moe.gdkirie.kirie:core` into `~/.m2` (unsigned unless a signing
key is configured). To publish from a workstation, put the properties in
`~/.gradle/gradle.properties` (never commit them):

```properties
mavenCentralUsername=<portal token username>
mavenCentralPassword=<portal token password>
signingInMemoryKey=<armored private key, newlines as \n>
signingInMemoryKeyPassword=<passphrase>
```

then run `:plugin:publishToMavenCentral` (upload only, release manually in the
Portal UI) or `:plugin:publishAndReleaseToMavenCentral`.

## Relationship to zip / npm

| Lane | Artifact | Consumer |
| --- | --- | --- |
| Addon zip | `Kirie-release.aar` staged into the Godot addon | Godot projects installing Kirie as an addon |
| npm | `@gd-kirie/*`, `kirie` | Browser / CLI / tooling |
| NuGet | `GdKirie.*` | .NET / Godot C# hosts |
| Maven (this lane) | `moe.gdkirie.kirie:core` | Gradle/Maven Android hosts using `mavenCentral()` |

Publishing to Maven does not remove the addon-bundled AAR path.

## References

- [Central Publisher Portal](https://central.sonatype.org/publish/publish-portal-guide/)
- [Central requirements](https://central.sonatype.org/publish/requirements/)
- [GPG for Central](https://central.sonatype.org/publish/requirements/gpg/)
- [gradle-maven-publish-plugin: Central](https://vanniktech.github.io/gradle-maven-publish-plugin/central/)
