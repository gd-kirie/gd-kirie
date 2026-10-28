# Maven Publishing

Publishes [`moe.gdkirie.kirie:core`](../packages/kirie/native/android/plugin/build.gradle.kts)
to **Maven Central** via the
[Central Publisher Portal](https://central.sonatype.com).
Not GitHub Packages. Separate from the addon zip, npm, and NuGet lanes.

Godot Android exports keep using the addon-bundled AAR. Use this lane for
Gradle/Maven hosts that depend on the coordinate directly.

## Coordinates

| Field | Value |
| --- | --- |
| groupId | `moe.gdkirie.kirie` |
| artifactId | `core` |
| version | root `package.json` `version` |
| repository | Maven Central |

`org.godotengine:godot` is `compileOnly`; consumers must provide Godot.

Publishing uses
[`com.vanniktech.maven.publish`](https://vanniktech.github.io/gradle-maven-publish-plugin/central/):
release AAR plus sources/javadoc, signed POM, Portal upload with automatic
release.

## Consume

```kotlin
repositories {
    mavenCentral()
}

dependencies {
    implementation("moe.gdkirie.kirie:core:<version>")
}
```

## Required secrets

Organization or repository Actions secrets:

| Secret | Gradle property | What |
| --- | --- | --- |
| `MAVEN_PUBLISH_USERNAME` | `mavenCentralUsername` | Portal user-token username |
| `MAVEN_PUBLISH_PASSWORD` | `mavenCentralPassword` | Portal user-token password |
| `MAVEN_SIGNING_KEY` | `signingInMemoryKey` | ASCII-armored GPG private key |
| `MAVEN_SIGNING_KEY_ID` | `signingInMemoryKeyId` | Optional last 8 hex of key ID |
| `MAVEN_SIGNING_KEY_PASSWORD` | `signingInMemoryKeyPassword` | GPG key passphrase |

Public key must be on a keyserver Central accepts:

```sh
gpg --keyserver keyserver.ubuntu.com --send-keys <KEYID>
```

## Release

`Publish Maven Central` (`.github/workflows/maven-release.yml`) publishes on
pushed `v*` tags and on `workflow_dispatch`. Tag commits must be on `main`.
Central versions are immutable.

## Local validation

```sh
packages/kirie/native/android/gradlew \
  --project-dir packages/kirie/native/android \
  :plugin:publishToMavenLocal
```

Workstation publish: put the Gradle properties in `~/.gradle/gradle.properties`,
then run `:plugin:publishToMavenCentral` or
`:plugin:publishAndReleaseToMavenCentral`.

## References

- [Central Publisher Portal](https://central.sonatype.org/publish/publish-portal-guide/)
- [Central requirements](https://central.sonatype.org/publish/requirements/)
- [GPG for Central](https://central.sonatype.org/publish/requirements/gpg/)
- [gradle-maven-publish-plugin](https://vanniktech.github.io/gradle-maven-publish-plugin/central/)
