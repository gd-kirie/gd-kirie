import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assembleIosEmbedFromRawExport,
  configureStagedAndroidLibraryProject,
  createViteBuildConfig,
  exportAndroidEmbedArtifact,
  exportIosEmbedArtifact,
  listExportPresets,
  normalizeGradleModuleName,
  stageAndroidEmbed,
} from "@gd-kirie/build";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("@gd-kirie/build embed-ios", () => {
  it("prunes visionOS/opposite-mode/dangling xcframeworks, aligns .pck name, and omits WebKit when webview is absent", async () => {
    const root = createTempDir("kirie-build-ios-");
    const rawExportDir = path.join(root, "raw");
    const embedDir = path.join(root, ".kirie", "embed", "ios", "debug");
    const artifactDir = path.join(root, "dist", "kirie", "ios", "debug");

    const libgodotDeviceDir = path.join(
      rawExportDir,
      "libgodot.ios.debug.xcframework",
      "ios-arm64",
    );
    const libgodotSimDir = path.join(
      rawExportDir,
      "libgodot.ios.debug.xcframework",
      "ios-arm64_x86_64-simulator",
    );
    fs.mkdirSync(libgodotDeviceDir, { recursive: true });
    fs.mkdirSync(libgodotSimDir, { recursive: true });
    fs.writeFileSync(
      path.join(rawExportDir, "libgodot.ios.debug.xcframework", "Info.plist"),
      "<plist/>",
    );
    fs.writeFileSync(path.join(libgodotDeviceDir, "libgodot.a"), "orig-device");
    fs.writeFileSync(path.join(libgodotSimDir, "libgodot.a"), "orig-sim");

    // Opposite-mode release xcframework must be skipped in debug mode.
    const releaseSimDir = path.join(
      rawExportDir,
      "libgodot.ios.release.xcframework",
      "ios-arm64",
    );
    fs.mkdirSync(releaseSimDir, { recursive: true });
    fs.writeFileSync(
      path.join(rawExportDir, "libgodot.ios.release.xcframework", "Info.plist"),
      "<plist/>",
    );
    fs.writeFileSync(path.join(releaseSimDir, "libgodot.a"), "release-device");

    // visionOS xcframework with xros-arm64/empty must be pruned.
    const visionSlice = path.join(
      rawExportDir,
      "libgodot.visionos.debug.xcframework",
      "xros-arm64",
    );
    fs.mkdirSync(visionSlice, { recursive: true });
    fs.writeFileSync(
      path.join(rawExportDir, "libgodot.visionos.debug.xcframework", "Info.plist"),
      "<plist/>",
    );
    fs.writeFileSync(path.join(visionSlice, "empty"), "");

    // Empty/dangling MoltenVK directory without slices or Info.plist must be pruned.
    fs.mkdirSync(path.join(rawExportDir, "MoltenVK.xcframework"), { recursive: true });

    fs.writeFileSync(path.join(rawExportDir, "GodotProj.pck"), "godot-pack");
    fs.writeFileSync(
      path.join(rawExportDir, "dummy.cpp"),
      `void godot_apple_embedded_plugins_initialize();
void godot_apple_embedded_plugins_deinitialize();
void godot_apple_embedded_plugins_initialize() {}
void godot_apple_embedded_plugins_deinitialize() {}
`,
    );

    const replacementSim = path.join(root, "arm64-sim-libgodot.a");
    fs.writeFileSync(replacementSim, "arm64-sim");

    const staged = assembleIosEmbedFromRawExport({
      cwd: root,
      embedDir,
      executableName: "HostApp",
      mode: "debug",
      rawExportDir,
      resolveSimulatorLibgodot: () => replacementSim,
      simulator: true,
    });

    expect(staged.manifest.frameworks).toEqual(["Frameworks/libgodot.ios.debug.xcframework"]);
    expect(staged.manifest.pckFile).toBe("Resources/HostApp.pck");
    expect(fs.existsSync(path.join(embedDir, "Resources", "HostApp.pck"))).toBe(true);
    expect(fs.existsSync(path.join(embedDir, "Frameworks", "MoltenVK.xcframework"))).toBe(false);
    expect(
      fs.existsSync(path.join(embedDir, "Frameworks", "libgodot.visionos.debug.xcframework")),
    ).toBe(false);
    expect(
      fs.readFileSync(
        path.join(
          embedDir,
          "Frameworks",
          "libgodot.ios.debug.xcframework",
          "ios-arm64_x86_64-simulator",
          "libgodot.a",
        ),
        "utf8",
      ),
    ).toBe("arm64-sim");

    const xcconfig = fs.readFileSync(path.join(embedDir, "KirieEmbed.xcconfig"), "utf8");
    expect(xcconfig).toContain("-lgodot");
    expect(xcconfig).not.toContain("-framework \"libgodot.ios.debug\"");
    expect(xcconfig).not.toContain("-framework WebKit");

    const swiftSource = fs.readFileSync(
      path.join(embedDir, "Sources", "KirieGodotView.swift"),
      "utf8",
    );
    expect(swiftSource).toMatch(/XCODE_RUNNING_FOR_PREVIEWS/);
    expect(swiftSource).toContain("packName: String = \"HostApp\"");

    const bridgeSource = fs.readFileSync(
      path.join(embedDir, "Sources", "KirieHostBridge.mm"),
      "utf8",
    );
    expect(bridgeSource).toContain(
      "typedef int64_t (*StringToUtf8Fn)(const void *p_self, char *r_text, int64_t p_max_write_length);",
    );

    if (process.platform === "darwin") {
      const sdkResult = await execa("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]);
      const sdkPath = sdkResult.stdout.trim();
      const bridgeObj = path.join(root, "plain-bridge.o");
      const pluginsObj = path.join(root, "plain-plugins.o");

      await execa("xcrun", [
        "--sdk",
        "iphonesimulator",
        "clang++",
        "-std=c++17",
        "-fobjc-arc",
        "-isysroot",
        sdkPath,
        "-target",
        "arm64-apple-ios16.0-simulator",
        "-I",
        path.join(embedDir, "Sources"),
        "-c",
        path.join(embedDir, "Sources", "KirieHostBridge.mm"),
        "-o",
        bridgeObj,
      ]);
      await execa("xcrun", [
        "--sdk",
        "iphonesimulator",
        "clang++",
        "-std=c++17",
        "-fobjc-arc",
        "-isysroot",
        sdkPath,
        "-target",
        "arm64-apple-ios16.0-simulator",
        "-I",
        path.join(embedDir, "Sources"),
        "-c",
        path.join(embedDir, "Sources", "KirieGodotPlugins.mm"),
        "-o",
        pluginsObj,
      ]);

      const bridgeNm = (await execa("xcrun", ["nm", bridgeObj])).stdout;
      const pluginsNm = (await execa("xcrun", ["nm", pluginsObj])).stdout;
      expect(bridgeNm).toMatch(/\bU __Z28gdextension_get_proc_addressPKc\b/);
      expect(bridgeNm).not.toMatch(/\bU _gdextension_get_proc_address\b/);
      expect(pluginsNm).toMatch(/\bT __Z39godot_apple_embedded_plugins_initializev\b/);
      expect(pluginsNm).toMatch(/\bT __Z41godot_apple_embedded_plugins_deinitializev\b/);

      await execa("xcrun", [
        "--sdk",
        "iphonesimulator",
        "swiftc",
        "-sdk",
        sdkPath,
        "-target",
        "arm64-apple-ios16.0-simulator",
        "-import-objc-header",
        path.join(embedDir, "Sources", "KirieGodotBridge.h"),
        "-typecheck",
        path.join(embedDir, "Sources", "KirieGodotView.swift"),
      ]);
    }

    await exportIosEmbedArtifact({
      embedDir,
      outputDir: artifactDir,
    });
    expect(fs.existsSync(path.join(artifactDir, "Resources", "HostApp.pck"))).toBe(true);
    expect(fs.readFileSync(path.join(artifactDir, "KirieEmbed.xcconfig"), "utf8")).toContain(
      artifactDir,
    );
  });

  it("compiles macro-chained webview dummy.cpp and links inner Kirie.framework + WebKit", async () => {
    const root = createTempDir("kirie-build-ios-webview-");
    const rawExportDir = path.join(root, "raw");
    const embedDir = path.join(root, ".kirie", "embed", "ios", "debug");

    const kirieDeviceFw = path.join(
      rawExportDir,
      "Kirie.debug.xcframework",
      "ios-arm64",
      "Kirie.framework",
    );
    const kirieSimFw = path.join(
      rawExportDir,
      "Kirie.debug.xcframework",
      "ios-arm64_x86_64-simulator",
      "Kirie.framework",
    );
    fs.mkdirSync(kirieDeviceFw, { recursive: true });
    fs.mkdirSync(kirieSimFw, { recursive: true });
    fs.writeFileSync(
      path.join(rawExportDir, "Kirie.debug.xcframework", "Info.plist"),
      "<plist/>",
    );
    fs.writeFileSync(path.join(rawExportDir, "App.pck"), "godot-pack");
    fs.writeFileSync(
      path.join(rawExportDir, "dummy.cpp"),
      `extern void init_kirie();
extern void deinit_kirie();

void kirie_generated_plugin_initialize();
void kirie_generated_plugin_deinitialize();

void godot_apple_embedded_plugins_initialize() {
\tinit_kirie();
\tkirie_generated_plugin_initialize();
}

void godot_apple_embedded_plugins_deinitialize() {
\tkirie_generated_plugin_deinitialize();
\tdeinit_kirie();
}

#undef godot_apple_embedded_plugins_initialize
#undef godot_apple_embedded_plugins_deinitialize
#define godot_apple_embedded_plugins_initialize kirie_generated_plugin_initialize
#define godot_apple_embedded_plugins_deinitialize kirie_generated_plugin_deinitialize

void godot_apple_embedded_plugins_initialize();
void godot_apple_embedded_plugins_deinitialize();
void godot_apple_embedded_plugins_initialize() {}
void godot_apple_embedded_plugins_deinitialize() {}
`,
    );

    assembleIosEmbedFromRawExport({
      cwd: root,
      embedDir,
      mode: "debug",
      rawExportDir,
      simulator: true,
    });

    const xcconfig = fs.readFileSync(path.join(embedDir, "KirieEmbed.xcconfig"), "utf8");
    expect(xcconfig).toContain("-framework \"Kirie\"");
    expect(xcconfig).not.toContain("-framework \"Kirie.debug\"");
    expect(xcconfig).toContain("-framework WebKit");

    if (process.platform === "darwin") {
      const sdkResult = await execa("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"]);
      const sdkPath = sdkResult.stdout.trim();
      const pluginsObj = path.join(root, "chained-plugins.o");

      await execa("xcrun", [
        "--sdk",
        "iphonesimulator",
        "clang++",
        "-std=c++17",
        "-fobjc-arc",
        "-isysroot",
        sdkPath,
        "-target",
        "arm64-apple-ios16.0-simulator",
        "-I",
        path.join(embedDir, "Sources"),
        "-c",
        path.join(embedDir, "Sources", "KirieGodotPlugins.mm"),
        "-o",
        pluginsObj,
      ]);

      const pluginsNm = (await execa("xcrun", ["nm", pluginsObj])).stdout;
      expect(pluginsNm).toMatch(/\bT __Z39godot_apple_embedded_plugins_initializev\b/);
      expect(pluginsNm).toMatch(/\bT __Z41godot_apple_embedded_plugins_deinitializev\b/);
      expect(pluginsNm).toMatch(/\bU __Z10init_kiriev\b/);
      expect(pluginsNm).toMatch(/\bU _kirie_host_bridge_initialize\b/);
    }
  });
});

describe("@gd-kirie/build embed-android & presets", () => {
  it("merges Godot library resources + manifest + .NET native artifacts without touching Godot project", async () => {
    const root = createTempDir("kirie-build-android-");
    const projectDir = path.join(root, "godot-proj");
    const embedDir = path.join(root, ".kirie", "embed", "android", "debug");
    const artifactDir = path.join(root, "dist", "kirie", "android", "debug");

    // Populate simulated Godot .NET temp runtime outputs in projectDir/.godot/mono/temp/bin
    const monoRuntimeDir = path.join(
      projectDir,
      ".godot",
      "mono",
      "temp",
      "bin",
      "ExportRelease",
      "android-arm64",
    );
    fs.mkdirSync(monoRuntimeDir, { recursive: true });
    fs.writeFileSync(path.join(monoRuntimeDir, "libmonosgen-2.0.so"), "mono-sgen");
    fs.writeFileSync(path.join(monoRuntimeDir, "libSystem.Native.so"), "sys-native");

    // Build a synthetic android_source.zip containing godot-lib.template_debug.aar + res/
    const templateSrc = path.join(root, "tpl-src");
    const aarSrc = path.join(root, "aar-src");
    fs.mkdirSync(path.join(aarSrc, "jni", "arm64-v8a"), { recursive: true });
    fs.mkdirSync(path.join(aarSrc, "jni", "armeabi-v7a"), { recursive: true });
    fs.mkdirSync(path.join(aarSrc, "res", "values"), { recursive: true });
    fs.mkdirSync(path.join(aarSrc, "res", "xml"), { recursive: true });
    fs.writeFileSync(path.join(aarSrc, "classes.jar"), "godot-classes");
    fs.writeFileSync(path.join(aarSrc, "jni", "arm64-v8a", "libgodot_android.so"), "godot-so");
    fs.writeFileSync(path.join(aarSrc, "jni", "armeabi-v7a", "libgodot_android.so"), "godot-so32");
    fs.writeFileSync(
      path.join(aarSrc, "res", "values", "values.xml"),
      `<resources><dimen name="text_edit_height">48dp</dimen><string name="godot_project_name_string">godot</string></resources>`,
    );
    fs.writeFileSync(path.join(aarSrc, "res", "xml", "godot_provider_paths.xml"), "<paths/>");
    fs.writeFileSync(
      path.join(aarSrc, "AndroidManifest.xml"),
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><meta-data android:name="org.godotengine.library.version" android:value="4.7.2.stable" /></application></manifest>`,
    );

    fs.mkdirSync(path.join(templateSrc, "libs", "debug"), { recursive: true });
    fs.mkdirSync(path.join(templateSrc, "res", "values"), { recursive: true });
    fs.mkdirSync(path.join(templateSrc, "src", "main", "java", "com", "godot", "game"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(templateSrc, "res", "values", "godot_project_name_string.xml"),
      `<resources><string name="godot_project_name_string">dup</string></resources>`,
    );
    fs.writeFileSync(
      path.join(templateSrc, "res", "values", "themes.xml"),
      `<resources><style name="GodotAppMainTheme"/></resources>`,
    );
    fs.writeFileSync(
      path.join(templateSrc, "src", "main", "java", "com", "godot", "game", "GodotApp.java"),
      "class GodotApp {}",
    );
    await execa(
      "zip",
      [
        "-q",
        "-r",
        path.join(templateSrc, "libs", "debug", "godot-lib.template_debug.aar"),
        ".",
      ],
      { cwd: aarSrc },
    );

    const androidSourceZipPath = path.join(root, "android_source.zip");
    await execa("zip", ["-q", "-r", androidSourceZipPath, "."], { cwd: templateSrc });

    // Create a mock godot executable that produces assets.zip containing .godot/mono/publish/arm64
    const assetsSrc = path.join(root, "assets-src");
    fs.mkdirSync(path.join(assetsSrc, ".godot", "mono", "publish", "arm64"), { recursive: true });
    fs.writeFileSync(
      path.join(
        assetsSrc,
        ".godot",
        "mono",
        "publish",
        "arm64",
        "libSystem.Security.Cryptography.Native.Android.jar",
      ),
      "crypto-jar",
    );
    const preparedAssetsZip = path.join(root, "prepared-assets.zip");
    await execa("zip", ["-q", "-r", preparedAssetsZip, "."], { cwd: assetsSrc });

    const mockGodot = path.join(root, "mock-godot.mjs");
    fs.writeFileSync(
      mockGodot,
      `#!/usr/bin/env node
import fs from "node:fs";
const out = process.argv[process.argv.length - 1];
fs.copyFileSync(${JSON.stringify(preparedAssetsZip)}, out);
`,
      { mode: 0o755 },
    );

    await stageAndroidEmbed({
      androidSourceZipPath,
      assembleAar: false,
      cwd: root,
      embedDir,
      godotCommand: mockGodot,
      mode: "debug",
      preset: "Android",
      projectDir,
    });

    const godotBuildDir = path.join(embedDir, "godot-build");
    expect(fs.existsSync(path.join(projectDir, "android"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(godotBuildDir, "src", "main", "java", "com", "godot", "game", "GodotApp.java"),
      ),
    ).toBe(false);

    const buildGradle = fs.readFileSync(path.join(godotBuildDir, "build.gradle"), "utf8");
    expect(buildGradle).toContain("namespace = 'org.godotengine.godot'");
    expect(buildGradle).toContain("androidx.documentfile:documentfile");
    expect(buildGradle).toContain("androidx.core:core-splashscreen");

    const manifestXml = fs.readFileSync(
      path.join(godotBuildDir, "src", "main", "AndroidManifest.xml"),
      "utf8",
    );
    expect(manifestXml).toContain("org.godotengine.library.version");
    expect(manifestXml).toContain("org.godotengine.plugin.v2.KirieHost");
    expect(manifestXml).toContain("org.godotengine.godot.utils.ProcessPhoenix");
    expect(manifestXml).toContain("androidx.core.content.FileProvider");

    // Duplicate godot_project_name_string.xml skipped because values.xml already defines it, while themes.xml is kept.
    expect(
      fs.existsSync(path.join(godotBuildDir, "src", "main", "res", "values", "values.xml")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(godotBuildDir, "src", "main", "res", "values", "themes.xml")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          godotBuildDir,
          "src",
          "main",
          "res",
          "values",
          "godot_project_name_string.xml",
        ),
      ),
    ).toBe(false);

    // .NET runtime .so staged into arm64-v8a, unexported armeabi-v7a pruned, and crypto jar staged in embed-libs/
    expect(
      fs.existsSync(
        path.join(godotBuildDir, "src", "main", "jniLibs", "arm64-v8a", "libmonosgen-2.0.so"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(godotBuildDir, "src", "main", "jniLibs", "arm64-v8a", "libSystem.Native.so"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(godotBuildDir, "src", "main", "jniLibs", "armeabi-v7a")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          godotBuildDir,
          "embed-libs",
          "libSystem.Security.Cryptography.Native.Android.jar",
        ),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(godotBuildDir, "embed-libs", "godot-lib.jar"))).toBe(true);

    // Standalone configureStagedAndroidLibraryProject also works on minimal trees
    const minDir = path.join(root, "min-android");
    configureStagedAndroidLibraryProject({
      godotBuildDir: minDir,
      sourcesDir: path.join(minDir, "Sources"),
    });
    expect(
      fs.existsSync(
        path.join(minDir, "src", "main", "res", "xml", "godot_provider_paths.xml"),
      ),
    ).toBe(true);

    fs.writeFileSync(path.join(embedDir, "godot-embed-debug.aar"), "fake-aar");
    await exportAndroidEmbedArtifact({
      embedDir,
      outputDir: artifactDir,
    });
    expect(fs.existsSync(path.join(artifactDir, "godot-embed-debug.aar"))).toBe(true);
    expect(fs.existsSync(path.join(artifactDir, "Sources", "KirieGodotFragment.kt"))).toBe(true);
    expect(normalizeGradleModuleName(undefined)).toBe(":app");
    expect(normalizeGradleModuleName("host-app")).toBe(":host-app");
    expect(normalizeGradleModuleName(":feature:host")).toBe(":feature:host");
  });

  it("lists export presets and validates Kirie-owned webview.vite options", async () => {
    const root = createTempDir("kirie-build-presets-");
    fs.writeFileSync(
      path.join(root, "export_presets.cfg"),
      `[preset.0]
name="macOS"
platform="macOS"

[preset.0.options]
binary_format/architecture="arm64"
`,
    );

    const presets = listExportPresets(root);
    expect(presets).toMatchObject([
      { name: "macOS", platform: "macOS" },
    ]);

    await expect(
      createViteBuildConfig({
        viteConfig: { root: "/nope" },
        webRoot: root,
      }),
    ).rejects.toThrow("webview.vite.root is owned by Kirie");
  });
});
