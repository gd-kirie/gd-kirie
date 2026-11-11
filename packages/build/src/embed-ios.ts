import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

import { exportGodotPreset, type ExportMode } from "./godot.ts";

export interface IosEmbedManifest {
  frameworks: string[];
  mode: ExportMode;
  pckFile: string;
  platform: "ios";
  resources: string[];
  sources: string[];
  xcconfig: string;
}

export interface StageIosEmbedOptions {
  cwd: string;
  embedDir?: string;
  executableName?: string;
  godotArgs?: string[];
  godotCommand: string;
  mode: ExportMode;
  preset: string;
  projectDir: string;
  resolveSimulatorLibgodot?: (cwd: string, release: boolean) => string | undefined;
  simulator?: boolean;
  userArgs?: string[];
}

export interface StagedIosEmbed {
  embedDir: string;
  manifest: IosEmbedManifest;
}

export interface BuildIosNativeHostAppOptions {
  appPath: string;
  cwd: string;
  derivedDataPath?: string;
  device?: string;
  embedDir: string;
  projectPath: string;
  release?: boolean;
  scheme?: string;
  simulator: boolean;
}

export interface ExportIosEmbedArtifactOptions {
  embedDir: string;
  outputDir: string;
}

export function resolveDefaultIosEmbedDir(cwd: string, mode: ExportMode): string {
  return path.resolve(cwd, ".kirie", "embed", "ios", mode);
}

export async function stageIosEmbed(options: StageIosEmbedOptions): Promise<StagedIosEmbed> {
  const embedDir = path.resolve(
    options.cwd,
    options.embedDir ?? resolveDefaultIosEmbedDir(options.cwd, options.mode),
  );
  const rawExportDir = fs.mkdtempSync(path.join(os.tmpdir(), "kirie-ios-embed-"));
  const projectBase = sanitizeTargetBaseName(
    options.executableName ?? path.basename(options.projectDir),
  );
  const rawXcodeProjectPath = path.join(rawExportDir, `${projectBase}.xcodeproj`);

  try {
    await exportGodotPreset({
      godotArgs: options.godotArgs,
      godotCommand: options.godotCommand,
      mode: options.mode,
      outputPath: rawXcodeProjectPath,
      preset: options.preset,
      projectDir: options.projectDir,
      userArgs: options.userArgs,
    });

    return assembleIosEmbedFromRawExport({
      cwd: options.cwd,
      embedDir,
      executableName: options.executableName,
      mode: options.mode,
      rawExportDir,
      resolveSimulatorLibgodot: options.resolveSimulatorLibgodot,
      simulator: options.simulator ?? false,
    });
  } finally {
    fs.rmSync(rawExportDir, { force: true, recursive: true });
  }
}

export interface AssembleIosEmbedFromRawExportOptions {
  cwd: string;
  embedDir: string;
  executableName?: string;
  mode: ExportMode;
  rawExportDir: string;
  resolveSimulatorLibgodot?: (cwd: string, release: boolean) => string | undefined;
  simulator: boolean;
}

export function assembleIosEmbedFromRawExport(
  options: AssembleIosEmbedFromRawExportOptions,
): StagedIosEmbed {
  const frameworksDir = path.join(options.embedDir, "Frameworks");
  const resourcesDir = path.join(options.embedDir, "Resources");
  const sourcesDir = path.join(options.embedDir, "Sources");

  fs.rmSync(options.embedDir, { force: true, recursive: true });
  fs.mkdirSync(frameworksDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.mkdirSync(sourcesDir, { recursive: true });

  const discoveredFrameworks = collectValidXcframeworks(options.rawExportDir, options.mode);
  const frameworkNames: string[] = [];

  for (const frameworkPath of discoveredFrameworks) {
    const frameworkName = path.basename(frameworkPath);
    fs.cpSync(frameworkPath, path.join(frameworksDir, frameworkName), { recursive: true });
    frameworkNames.push(frameworkName);
  }
  frameworkNames.sort();

  if (options.simulator && options.resolveSimulatorLibgodot) {
    const arm64SimLib = options.resolveSimulatorLibgodot(
      options.cwd,
      options.mode === "release",
    );
    const targetSimLib = findSimulatorLibgodotInDir(frameworksDir);
    if (arm64SimLib && targetSimLib) {
      fs.copyFileSync(arm64SimLib, targetSimLib);
    }
  }

  const pckSource = findFirstFileByExtension(options.rawExportDir, ".pck");
  if (!pckSource) {
    throw new Error(
      `Godot iOS export did not produce a .pck archive in ${options.rawExportDir}.`,
    );
  }

  const pckFile = options.executableName
    ? `${sanitizeTargetBaseName(options.executableName)}.pck`
    : path.basename(pckSource);
  fs.copyFileSync(pckSource, path.join(resourcesDir, pckFile));
  const resources = [pckFile];

  for (const entry of fs.readdirSync(options.rawExportDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("data_")) {
      fs.cpSync(
        path.join(options.rawExportDir, entry.name),
        path.join(resourcesDir, entry.name),
        { recursive: true },
      );
      resources.push(entry.name);
    }
  }
  resources.sort();

  const dummyCppPath = findFirstFileByName(options.rawExportDir, "dummy.cpp");
  const dummyCppSource = dummyCppPath
    ? fs.readFileSync(dummyCppPath, "utf8")
    : "";

  fs.writeFileSync(path.join(sourcesDir, "KirieGodotBridge.h"), renderKirieGodotBridgeHeader());
  fs.writeFileSync(path.join(sourcesDir, "KirieHostBridge.mm"), renderKirieHostBridgeObjCpp());
  fs.writeFileSync(
    path.join(sourcesDir, "KirieGodotPlugins.mm"),
    renderKirieGodotPluginsObjCpp(dummyCppSource),
  );
  fs.writeFileSync(
    path.join(sourcesDir, "KirieGodotView.swift"),
    renderKirieGodotViewSwift(path.basename(pckFile, ".pck")),
  );

  const sources = [
    "Sources/KirieGodotBridge.h",
    "Sources/KirieGodotPlugins.mm",
    "Sources/KirieGodotView.swift",
    "Sources/KirieHostBridge.mm",
  ];
  const xcconfig = "KirieEmbed.xcconfig";
  fs.writeFileSync(
    path.join(options.embedDir, xcconfig),
    renderKirieEmbedXcconfig(options.embedDir, frameworkNames),
  );

  const manifest: IosEmbedManifest = {
    frameworks: frameworkNames.map((name) => `Frameworks/${name}`),
    mode: options.mode,
    pckFile: `Resources/${pckFile}`,
    platform: "ios",
    resources: resources.map((name) => `Resources/${name}`),
    sources,
    xcconfig,
  };
  fs.writeFileSync(
    path.join(options.embedDir, "embed-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return {
    embedDir: options.embedDir,
    manifest,
  };
}

export async function exportIosEmbedArtifact(
  options: ExportIosEmbedArtifactOptions,
): Promise<string> {
  const sourceDir = path.resolve(options.embedDir);
  const outputDir = path.resolve(options.outputDir);

  if (sourceDir !== outputDir) {
    fs.rmSync(outputDir, { force: true, recursive: true });
    fs.mkdirSync(path.dirname(outputDir), { recursive: true });
    fs.cpSync(sourceDir, outputDir, { recursive: true });

    const manifestPath = path.join(outputDir, "embed-manifest.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as IosEmbedManifest;
      const frameworkNames = manifest.frameworks.map((item) => path.basename(item));
      fs.writeFileSync(
        path.join(outputDir, manifest.xcconfig),
        renderKirieEmbedXcconfig(outputDir, frameworkNames),
      );
    }
  }

  return outputDir;
}

export async function resolveXcodeSchemes(
  projectPath: string,
  cwd: string,
): Promise<string[]> {
  const resolvedProject = path.resolve(cwd, projectPath);
  const projectFlag = resolvedProject.endsWith(".xcworkspace")
    ? "-workspace"
    : "-project";
  const result = await execa("xcodebuild", [
    projectFlag,
    resolvedProject,
    "-list",
    "-json",
  ], {
    cwd,
  });
  const parsed = JSON.parse(result.stdout) as {
    project?: { schemes?: string[] };
    workspace?: { schemes?: string[] };
  };
  return parsed.workspace?.schemes ?? parsed.project?.schemes ?? [];
}

export async function resolveTargetXcodeScheme(options: {
  cwd: string;
  projectPath: string;
  scheme?: string;
}): Promise<string> {
  if (options.scheme) {
    return options.scheme;
  }

  const schemes = await resolveXcodeSchemes(options.projectPath, options.cwd);
  if (schemes.length === 1) {
    return schemes[0]!;
  }
  if (schemes.length === 0) {
    throw new Error(
      `No shared Xcode schemes found in ${options.projectPath}. Set targets.ios.scheme in kirie.config.ts.`,
    );
  }

  throw new Error(
    `Multiple Xcode schemes found in ${options.projectPath} (${schemes.join(", ")}). Set targets.ios.scheme in kirie.config.ts.`,
  );
}

export async function buildIosNativeHostApp(
  options: BuildIosNativeHostAppOptions,
): Promise<void> {
  const resolvedProject = path.resolve(options.cwd, options.projectPath);
  if (!fs.existsSync(resolvedProject)) {
    throw new Error(`Xcode project not found: ${resolvedProject}`);
  }

  const scheme = await resolveTargetXcodeScheme({
    cwd: options.cwd,
    projectPath: resolvedProject,
    scheme: options.scheme,
  });
  const projectFlag = resolvedProject.endsWith(".xcworkspace")
    ? "-workspace"
    : "-project";
  const appPath = path.resolve(options.cwd, options.appPath);
  const rawBuildDir = path.join(
    path.dirname(appPath),
    options.simulator ? "ios_native_sim_build" : "ios_native_device_build",
  );

  fs.mkdirSync(path.dirname(appPath), { recursive: true });
  fs.rmSync(appPath, { force: true, recursive: true });
  fs.rmSync(rawBuildDir, { force: true, recursive: true });
  fs.mkdirSync(rawBuildDir, { recursive: true });

  const args = [
    projectFlag,
    resolvedProject,
    "-scheme",
    scheme,
    "-sdk",
    options.simulator ? "iphonesimulator" : "iphoneos",
    "-destination",
    options.simulator
      ? "generic/platform=iOS Simulator"
      : options.device
        ? `id=${options.device}`
        : "generic/platform=iOS",
    "-configuration",
    options.release ? "Release" : "Debug",
  ];

  if (options.derivedDataPath) {
    args.push("-derivedDataPath", path.resolve(options.cwd, options.derivedDataPath));
  }

  args.push(
    `CONFIGURATION_BUILD_DIR=${rawBuildDir}`,
    `KIRIE_EMBED_DIR=${path.resolve(options.embedDir)}`,
    "ARCHS=arm64",
    ...(options.simulator
      ? [
          "CODE_SIGNING_ALLOWED=NO",
          "CODE_SIGNING_REQUIRED=NO",
          "CODE_SIGN_IDENTITY=",
          "EXCLUDED_ARCHS=x86_64",
        ]
      : ["-allowProvisioningUpdates"]),
    "ONLY_ACTIVE_ARCH=YES",
    "build",
  );

  try {
    await execa("xcodebuild", args, {
      cwd: options.cwd,
      stdio: "inherit",
    });

    const builtApp = findBuiltAppBundle(rawBuildDir, scheme);
    if (!builtApp) {
      throw new Error(`xcodebuild did not produce a .app bundle in ${rawBuildDir}.`);
    }

    fs.renameSync(builtApp, appPath);
  } finally {
    fs.rmSync(rawBuildDir, { force: true, recursive: true });
  }
}

function findBuiltAppBundle(buildDir: string, preferredScheme: string): string | undefined {
  const preferred = path.join(buildDir, `${preferredScheme}.app`);
  if (fs.existsSync(preferred)) {
    return preferred;
  }

  const entries = fs.readdirSync(buildDir, { withFileTypes: true });
  const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  return appEntry
    ? path.join(buildDir, appEntry.name)
    : undefined;
}

function collectValidXcframeworks(rootDir: string, mode: ExportMode): string[] {
  const results = new Map<string, string>();
  const oppositeModeSuffix = mode === "debug"
    ? ".release.xcframework"
    : ".debug.xcframework";

  const visit = (dirPath: string): void => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      const stat = fs.statSync(fullPath, { throwIfNoEntry: false });
      if (!stat?.isDirectory()) {
        continue;
      }

      if (entry.name.endsWith(".xcframework")) {
        if (entry.name.toLowerCase().endsWith(oppositeModeSuffix)) {
          continue;
        }
        if (isValidXcframework(fullPath) && !results.has(entry.name)) {
          results.set(entry.name, fullPath);
        }
        continue;
      }

      if (entry.name.endsWith(".xcodeproj")) {
        continue;
      }

      visit(fullPath);
    }
  };

  visit(rootDir);
  return [
    ...results.values(),
  ];
}

function isValidXcframework(xcframeworkPath: string): boolean {
  const infoPlist = path.join(xcframeworkPath, "Info.plist");
  if (!fs.existsSync(infoPlist)) {
    return false;
  }

  return fs.readdirSync(xcframeworkPath, { withFileTypes: true }).some((sliceEntry) => {
    if (!sliceEntry.isDirectory() || !sliceEntry.name.startsWith("ios-")) {
      return false;
    }

    const sliceDir = path.join(xcframeworkPath, sliceEntry.name);
    return fs.readdirSync(sliceDir, { withFileTypes: true }).some(
      (artifact) =>
        (artifact.isFile() && artifact.name.endsWith(".a")) ||
        (artifact.isDirectory() && artifact.name.endsWith(".framework")),
    );
  });
}

function findSimulatorLibgodotInDir(dirPath: string): string | undefined {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = findSimulatorLibgodotInDir(fullPath);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.name === "libgodot.a" && fullPath.includes("simulator")) {
      return fullPath;
    }
  }

  return undefined;
}

function findFirstFileByExtension(dirPath: string, extension: string): string | undefined {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".xcodeproj") || entry.name.endsWith(".xcframework")) {
        continue;
      }
      const nested = findFirstFileByExtension(fullPath, extension);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(extension)) {
      return fullPath;
    }
  }

  return undefined;
}

function findFirstFileByName(dirPath: string, fileName: string): string | undefined {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".xcodeproj") || entry.name.endsWith(".xcframework")) {
        continue;
      }
      const nested = findFirstFileByName(fullPath, fileName);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
  }

  return undefined;
}

function sanitizeTargetBaseName(name: string): string {
  const cleaned = name.replaceAll(/\W+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "GodotEmbed";
}

function renderKirieGodotBridgeHeader(): string {
  return `#pragma once

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class GDTViewController;

@interface GDTApplicationDelegate : NSObject <UIApplicationDelegate, UIWindowSceneDelegate>
@end

@interface GDTAppDelegateService : NSObject <UIApplicationDelegate, UIWindowSceneDelegate>
@property(strong, class, nonatomic, nullable) GDTViewController *viewController;
@end

@interface GDTViewController : UIViewController
@end

typedef void (^KirieHostMessageHandler)(NSString *message);

@interface KirieHostChannel : NSObject
@property(copy, class, nonatomic, nullable) KirieHostMessageHandler messageHandler;
+ (void)sendMessage:(NSString *)message;
@end

#ifdef __cplusplus
extern "C" {
#endif
void kirie_host_bridge_initialize(void);
void kirie_host_bridge_deinitialize(void);
#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END
`;
}

function renderKirieGodotPluginsObjCpp(dummyCppSource: string): string {
  const initDefinitionRegex = /\bvoid\s+godot_apple_embedded_plugins_initialize\s*\(\s*\)\s*\{/;
  const deinitDefinitionRegex = /\bvoid\s+godot_apple_embedded_plugins_deinitialize\s*\(\s*\)\s*\{/;
  const trimmed = dummyCppSource.trim();

  let rewritten = trimmed;
  if (initDefinitionRegex.test(rewritten)) {
    rewritten = rewritten.replace(
      initDefinitionRegex,
      "static void kirie_exported_apple_plugins_initialize() {",
    );
  } else {
    rewritten = `${rewritten}\nstatic void kirie_exported_apple_plugins_initialize() {}`.trim();
  }

  if (deinitDefinitionRegex.test(rewritten)) {
    rewritten = rewritten.replace(
      deinitDefinitionRegex,
      "static void kirie_exported_apple_plugins_deinitialize() {",
    );
  } else {
    rewritten = `${rewritten}\nstatic void kirie_exported_apple_plugins_deinitialize() {}`.trim();
  }

  return `#import "KirieGodotBridge.h"

${rewritten}

#undef godot_apple_embedded_plugins_initialize
#undef godot_apple_embedded_plugins_deinitialize

void godot_apple_embedded_plugins_initialize() {
  kirie_exported_apple_plugins_initialize();
  kirie_host_bridge_initialize();
}

void godot_apple_embedded_plugins_deinitialize() {
  kirie_host_bridge_deinitialize();
  kirie_exported_apple_plugins_deinitialize();
}
`;
}

function renderKirieHostBridgeObjCpp(): string {
  return `#import "KirieGodotBridge.h"
#include <cstdint>
#include <cstring>
#include <vector>

typedef void (*GDExtensionInterfaceFunctionPtr)();
GDExtensionInterfaceFunctionPtr gdextension_get_proc_address(const char *p_function_name);

namespace {

enum KirieVariantType : int32_t {
  KIRIE_VARIANT_NIL = 0,
  KIRIE_VARIANT_STRING = 4,
  KIRIE_VARIANT_STRING_NAME = 21,
  KIRIE_VARIANT_OBJECT = 24,
};

struct KirieCallError {
  int32_t error;
  int32_t argument;
  int32_t expected;
};

struct KiriePropertyInfo {
  int32_t type;
  void *name;
  void *class_name;
  uint32_t hint;
  void *hint_string;
  uint32_t usage;
};

typedef void *(*CreateInstance2Fn)(void *p_class_userdata, uint8_t p_notify_postinitialize);
typedef void (*FreeInstanceFn)(void *p_class_userdata, void *p_instance);

struct KirieClassCreationInfo4 {
  uint8_t is_virtual;
  uint8_t is_abstract;
  uint8_t is_exposed;
  uint8_t is_runtime;
  const void *icon_path;
  void *set_func;
  void *get_func;
  void *get_property_list_func;
  void *free_property_list_func;
  void *property_can_revert_func;
  void *property_get_revert_func;
  void *validate_property_func;
  void *notification_func;
  void *to_string_func;
  void *reference_func;
  void *unreference_func;
  CreateInstance2Fn create_instance_func;
  FreeInstanceFn free_instance_func;
  void *recreate_instance_func;
  void *get_virtual_func;
  void *get_virtual_call_data_func;
  void *call_virtual_with_data_func;
  void *class_userdata;
};

typedef void (*MethodCallFn)(
  void *method_userdata,
  void *p_instance,
  const void *const *p_args,
  int64_t p_argument_count,
  void *r_return,
  KirieCallError *r_error
);

struct KirieClassMethodInfo {
  void *name;
  void *method_userdata;
  MethodCallFn call_func;
  void *ptrcall_func;
  uint32_t method_flags;
  uint8_t has_return_value;
  KiriePropertyInfo *return_value_info;
  int32_t return_value_metadata;
  uint32_t argument_count;
  KiriePropertyInfo *arguments_info;
  int32_t *arguments_metadata;
  uint32_t default_argument_count;
  void **default_arguments;
};

typedef void (*StringNameNewUtf8Fn)(void *r_dest, const char *p_contents, uint8_t p_is_static);
typedef void (*StringNewUtf8Fn)(void *r_dest, const char *p_contents);
typedef int64_t (*StringToUtf8Fn)(const void *p_self, char *r_text, int64_t p_max_write_length);
typedef void (*PtrDestructorFn)(void *p_base);
typedef PtrDestructorFn (*VariantGetPtrDestructorFn)(int32_t p_type);
typedef void (*VariantFromTypeFn)(void *r_variant, void *p_value);
typedef void (*TypeFromVariantFn)(void *r_value, void *p_variant);
typedef VariantFromTypeFn (*GetVariantFromTypeFn)(int32_t p_type);
typedef TypeFromVariantFn (*GetVariantToTypeFn)(int32_t p_type);
typedef void (*VariantNewNilFn)(void *r_dest);
typedef void (*VariantDestroyFn)(void *p_self);
typedef void (*VariantCallFn)(
  void *p_self,
  const void *p_method,
  const void *const *p_args,
  int64_t p_arg_count,
  void *r_return,
  KirieCallError *r_error
);
typedef void *(*ConstructObjectFn)(const void *p_classname);
typedef void (*ObjectSetInstanceFn)(void *p_object, const void *p_classname, void *p_instance);
typedef void (*ObjectDestroyFn)(void *p_object);
typedef void *(*GlobalGetSingletonFn)(const void *p_name);
typedef void (*RegisterClass4Fn)(
  void *p_library,
  const void *p_class_name,
  const void *p_parent_class_name,
  const KirieClassCreationInfo4 *p_extension_funcs
);
typedef void (*RegisterMethodFn)(
  void *p_library,
  const void *p_class_name,
  const KirieClassMethodInfo *p_method_info
);
typedef void (*RegisterSignalFn)(
  void *p_library,
  const void *p_class_name,
  const void *p_signal_name,
  const KiriePropertyInfo *p_argument_info,
  int64_t p_argument_count
);
typedef void (*UnregisterClassFn)(void *p_library, const void *p_class_name);

struct alignas(8) OpaqueSlot {
  uint8_t bytes[32];
};

struct KirieGdApi {
  StringNameNewUtf8Fn string_name_new;
  StringNewUtf8Fn string_new;
  StringToUtf8Fn string_to_utf8;
  PtrDestructorFn destroy_string;
  PtrDestructorFn destroy_string_name;
  VariantFromTypeFn variant_from_string;
  VariantFromTypeFn variant_from_string_name;
  VariantFromTypeFn variant_from_object;
  TypeFromVariantFn string_from_variant;
  VariantNewNilFn variant_new_nil;
  VariantDestroyFn variant_destroy;
  VariantCallFn variant_call;
  ConstructObjectFn construct_object;
  ObjectSetInstanceFn object_set_instance;
  ObjectDestroyFn object_destroy;
  GlobalGetSingletonFn global_get_singleton;
  RegisterClass4Fn register_class4;
  RegisterMethodFn register_method;
  RegisterSignalFn register_signal;
  UnregisterClassFn unregister_class;
  bool ready;
};

static KirieGdApi g_api = {};
static void *g_extension_library = nullptr;
static void *g_singleton_object = nullptr;
static KirieHostMessageHandler g_message_handler = nil;
static int g_instance_token = 1;

template <typename Fn>
static Fn resolve_fn(const char *name) {
  return reinterpret_cast<Fn>(gdextension_get_proc_address(name));
}

static bool ensure_api() {
  if (g_api.ready) {
    return true;
  }

  g_api.string_name_new = resolve_fn<StringNameNewUtf8Fn>("string_name_new_with_utf8_chars");
  g_api.string_new = resolve_fn<StringNewUtf8Fn>("string_new_with_utf8_chars");
  g_api.string_to_utf8 = resolve_fn<StringToUtf8Fn>("string_to_utf8_chars");
  auto get_dtor = resolve_fn<VariantGetPtrDestructorFn>("variant_get_ptr_destructor");
  auto get_from_type = resolve_fn<GetVariantFromTypeFn>("get_variant_from_type_constructor");
  auto get_to_type = resolve_fn<GetVariantToTypeFn>("get_variant_to_type_constructor");
  g_api.variant_new_nil = resolve_fn<VariantNewNilFn>("variant_new_nil");
  g_api.variant_destroy = resolve_fn<VariantDestroyFn>("variant_destroy");
  g_api.variant_call = resolve_fn<VariantCallFn>("variant_call");
  g_api.construct_object = resolve_fn<ConstructObjectFn>("classdb_construct_object2");
  if (!g_api.construct_object) {
    g_api.construct_object = resolve_fn<ConstructObjectFn>("classdb_construct_object");
  }
  g_api.object_set_instance = resolve_fn<ObjectSetInstanceFn>("object_set_instance");
  g_api.object_destroy = resolve_fn<ObjectDestroyFn>("object_destroy");
  g_api.global_get_singleton = resolve_fn<GlobalGetSingletonFn>("global_get_singleton");
  g_api.register_class4 = resolve_fn<RegisterClass4Fn>("classdb_register_extension_class4");
  if (!g_api.register_class4) {
    g_api.register_class4 = resolve_fn<RegisterClass4Fn>("classdb_register_extension_class6");
  }
  g_api.register_method = resolve_fn<RegisterMethodFn>("classdb_register_extension_class_method");
  g_api.register_signal = resolve_fn<RegisterSignalFn>("classdb_register_extension_class_signal");
  g_api.unregister_class = resolve_fn<UnregisterClassFn>("classdb_unregister_extension_class");

  if (
    !g_api.string_name_new || !g_api.string_new || !g_api.string_to_utf8 ||
    !get_dtor || !get_from_type || !get_to_type || !g_api.variant_new_nil ||
    !g_api.variant_destroy || !g_api.variant_call || !g_api.construct_object ||
    !g_api.object_set_instance || !g_api.object_destroy || !g_api.global_get_singleton ||
    !g_api.register_class4 || !g_api.register_method || !g_api.register_signal ||
    !g_api.unregister_class
  ) {
    return false;
  }

  g_api.destroy_string = get_dtor(KIRIE_VARIANT_STRING);
  g_api.destroy_string_name = get_dtor(KIRIE_VARIANT_STRING_NAME);
  g_api.variant_from_string = get_from_type(KIRIE_VARIANT_STRING);
  g_api.variant_from_string_name = get_from_type(KIRIE_VARIANT_STRING_NAME);
  g_api.variant_from_object = get_from_type(KIRIE_VARIANT_OBJECT);
  g_api.string_from_variant = get_to_type(KIRIE_VARIANT_STRING);
  g_api.ready = (
    g_api.destroy_string && g_api.destroy_string_name &&
    g_api.variant_from_string && g_api.variant_from_string_name &&
    g_api.variant_from_object && g_api.string_from_variant
  );
  return g_api.ready;
}

class ScopedStringName {
public:
  explicit ScopedStringName(const char *value) {
    std::memset(&slot_, 0, sizeof(slot_));
    g_api.string_name_new(&slot_, value, 0);
  }
  ~ScopedStringName() {
    g_api.destroy_string_name(&slot_);
  }
  void *ptr() { return &slot_; }
private:
  OpaqueSlot slot_;
};

class ScopedString {
public:
  explicit ScopedString(const char *value) {
    std::memset(&slot_, 0, sizeof(slot_));
    g_api.string_new(&slot_, value);
  }
  ~ScopedString() {
    g_api.destroy_string(&slot_);
  }
  void *ptr() { return &slot_; }
private:
  OpaqueSlot slot_;
};

static void *kirie_host_create_instance(void *, uint8_t) {
  ScopedStringName object_sn("Object");
  ScopedStringName host_sn("KirieHost");
  void *obj = g_api.construct_object(object_sn.ptr());
  if (obj) {
    g_api.object_set_instance(obj, host_sn.ptr(), &g_instance_token);
  }
  return obj;
}

static void kirie_host_free_instance(void *, void *) {}

static void kirie_host_send_to_host_call(
  void *,
  void *,
  const void *const *p_args,
  int64_t p_argument_count,
  void *r_return,
  KirieCallError *r_error
) {
  if (r_return) {
    g_api.variant_new_nil(r_return);
  }
  if (r_error) {
    r_error->error = 0;
    r_error->argument = 0;
    r_error->expected = 0;
  }
  if (p_argument_count < 1 || !p_args || !p_args[0]) {
    return;
  }

  OpaqueSlot gd_str = {};
  g_api.string_from_variant(&gd_str, const_cast<void *>(p_args[0]));
  int64_t length = g_api.string_to_utf8(&gd_str, nullptr, 0);
  std::vector<char> utf8(static_cast<size_t>(length > 0 ? length : 0) + 1, '\\0');
  if (length > 0) {
    g_api.string_to_utf8(&gd_str, utf8.data(), length + 1);
  }
  g_api.destroy_string(&gd_str);

  NSString *nsMessage = [NSString stringWithUTF8String:utf8.data()] ?: @"";
  KirieHostMessageHandler handler = [KirieHostChannel messageHandler];
  if (!handler) {
    return;
  }
  if ([NSThread isMainThread]) {
    handler(nsMessage);
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      handler(nsMessage);
    });
  }
}

static void emit_host_message_signal(NSString *message) {
  if (!g_singleton_object || !ensure_api()) {
    return;
  }

  OpaqueSlot target_var = {};
  void *singleton_ptr = g_singleton_object;
  g_api.variant_from_object(&target_var, &singleton_ptr);

  ScopedStringName call_deferred_sn("call_deferred");
  ScopedStringName emit_signal_sn("emit_signal");
  ScopedStringName signal_sn("host_message_received");
  ScopedString payload_str(message.UTF8String ? message.UTF8String : "");

  OpaqueSlot arg_method_var = {};
  OpaqueSlot arg_signal_var = {};
  OpaqueSlot arg_payload_var = {};
  OpaqueSlot ret_var = {};
  g_api.variant_from_string_name(&arg_method_var, emit_signal_sn.ptr());
  g_api.variant_from_string_name(&arg_signal_var, signal_sn.ptr());
  g_api.variant_from_string(&arg_payload_var, payload_str.ptr());

  const void *args[3] = { &arg_method_var, &arg_signal_var, &arg_payload_var };
  KirieCallError err = {};
  g_api.variant_call(&target_var, call_deferred_sn.ptr(), args, 3, &ret_var, &err);

  g_api.variant_destroy(&ret_var);
  g_api.variant_destroy(&arg_payload_var);
  g_api.variant_destroy(&arg_signal_var);
  g_api.variant_destroy(&arg_method_var);
  g_api.variant_destroy(&target_var);
}

} // namespace

@implementation KirieHostChannel

+ (KirieHostMessageHandler)messageHandler {
  @synchronized(self) {
    return g_message_handler;
  }
}

+ (void)setMessageHandler:(KirieHostMessageHandler)messageHandler {
  @synchronized(self) {
    g_message_handler = [messageHandler copy];
  }
}

+ (void)sendMessage:(NSString *)message {
  emit_host_message_signal(message ?: @"");
}

@end

extern "C" void kirie_host_bridge_initialize(void) {
  if (g_singleton_object || !ensure_api()) {
    return;
  }

  ScopedStringName gdextension_sn("GDExtension");
  g_extension_library = g_api.construct_object(gdextension_sn.ptr());
  if (!g_extension_library) {
    return;
  }

  ScopedStringName class_sn("KirieHost");
  ScopedStringName parent_sn("Object");
  KirieClassCreationInfo4 class_info = {};
  class_info.is_exposed = 1;
  class_info.create_instance_func = &kirie_host_create_instance;
  class_info.free_instance_func = &kirie_host_free_instance;
  g_api.register_class4(g_extension_library, class_sn.ptr(), parent_sn.ptr(), &class_info);

  ScopedStringName empty_sn("");
  ScopedString empty_str("");
  ScopedStringName arg_name_sn("message");
  KiriePropertyInfo arg_prop = {
    KIRIE_VARIANT_STRING,
    arg_name_sn.ptr(),
    empty_sn.ptr(),
    0,
    empty_str.ptr(),
    6,
  };
  int32_t arg_meta = 0;

  ScopedStringName method_sn("send_to_host");
  KirieClassMethodInfo method_info = {};
  method_info.name = method_sn.ptr();
  method_info.call_func = &kirie_host_send_to_host_call;
  method_info.method_flags = 1;
  method_info.argument_count = 1;
  method_info.arguments_info = &arg_prop;
  method_info.arguments_metadata = &arg_meta;
  g_api.register_method(g_extension_library, class_sn.ptr(), &method_info);

  ScopedStringName signal_sn("host_message_received");
  g_api.register_signal(g_extension_library, class_sn.ptr(), signal_sn.ptr(), &arg_prop, 1);

  g_singleton_object = kirie_host_create_instance(nullptr, 1);
  if (!g_singleton_object) {
    return;
  }

  ScopedStringName engine_sn("Engine");
  void *engine_obj = g_api.global_get_singleton(engine_sn.ptr());
  if (!engine_obj) {
    return;
  }

  OpaqueSlot engine_var = {};
  OpaqueSlot name_var = {};
  OpaqueSlot instance_var = {};
  OpaqueSlot ret_var = {};
  g_api.variant_from_object(&engine_var, &engine_obj);
  g_api.variant_from_string_name(&name_var, class_sn.ptr());
  void *instance_ptr = g_singleton_object;
  g_api.variant_from_object(&instance_var, &instance_ptr);

  ScopedStringName register_sn("register_singleton");
  const void *args[2] = { &name_var, &instance_var };
  KirieCallError err = {};
  g_api.variant_call(&engine_var, register_sn.ptr(), args, 2, &ret_var, &err);

  g_api.variant_destroy(&ret_var);
  g_api.variant_destroy(&instance_var);
  g_api.variant_destroy(&name_var);
  g_api.variant_destroy(&engine_var);
}

extern "C" void kirie_host_bridge_deinitialize(void) {
  if (!g_singleton_object || !g_api.ready) {
    return;
  }

  ScopedStringName class_sn("KirieHost");
  ScopedStringName engine_sn("Engine");
  void *engine_obj = g_api.global_get_singleton(engine_sn.ptr());
  if (engine_obj) {
    OpaqueSlot engine_var = {};
    OpaqueSlot name_var = {};
    OpaqueSlot ret_var = {};
    g_api.variant_from_object(&engine_var, &engine_obj);
    g_api.variant_from_string_name(&name_var, class_sn.ptr());
    ScopedStringName unregister_sn("unregister_singleton");
    const void *args[1] = { &name_var };
    KirieCallError err = {};
    g_api.variant_call(&engine_var, unregister_sn.ptr(), args, 1, &ret_var, &err);
    g_api.variant_destroy(&ret_var);
    g_api.variant_destroy(&name_var);
    g_api.variant_destroy(&engine_var);
  }

  g_api.object_destroy(g_singleton_object);
  g_singleton_object = nullptr;

  if (g_extension_library) {
    g_api.unregister_class(g_extension_library, class_sn.ptr());
    g_api.object_destroy(g_extension_library);
    g_extension_library = nullptr;
  }
}
`;
}

function renderKirieGodotViewSwift(defaultPackBaseName: string): string {
  return `import SwiftUI
import UIKit

@MainActor
public enum KirieHost {
    public static var onMessage: ((String) -> Void)? {
        get { KirieHostChannel.messageHandler }
        set { KirieHostChannel.messageHandler = newValue }
    }

    public static func send(_ message: String) {
        KirieHostChannel.sendMessage(message)
    }
}

@MainActor
private final class KirieGodotControllerStore {
    static let shared = KirieGodotControllerStore()

    let viewController: GDTViewController

    private init() {
        let controller = GDTViewController()
        self.viewController = controller
        GDTAppDelegateService.viewController = controller
    }
}

public struct KirieGodotView: UIViewControllerRepresentable {
    public static var isXcodePreview: Bool {
        ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
    }

    public let packName: String

    public init(packName: String = "${defaultPackBaseName}") {
        self.packName = packName
    }

    public func makeUIViewController(context: Context) -> UIViewController {
        if Self.isXcodePreview {
            return Self.makePreviewPlaceholderController()
        }

        return KirieGodotControllerStore.shared.viewController
    }

    public func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}

    private static func makePreviewPlaceholderController() -> UIViewController {
        let controller = UIViewController()
        controller.view.backgroundColor = UIColor.secondarySystemBackground

        let label = UILabel()
        label.text = "KirieGodotView (Xcode Preview)"
        label.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .medium)
        label.textColor = UIColor.secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        controller.view.addSubview(label)

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: controller.view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: controller.view.centerYAnchor),
        ])

        return controller
    }
}
`;
}

function renderKirieEmbedXcconfig(embedDir: string, frameworkNames: string[]): string {
  const deviceFrameworkSearchPaths = new Set<string>();
  const simFrameworkSearchPaths = new Set<string>();
  const deviceLibrarySearchPaths = new Set<string>();
  const simLibrarySearchPaths = new Set<string>();
  const deviceLinkFlags = new Set<string>();
  const simLinkFlags = new Set<string>();
  let hasKirieWebViewFramework = false;

  for (const xcframeworkName of frameworkNames) {
    const xcframeworkDir = path.join(embedDir, "Frameworks", xcframeworkName);
    if (!fs.existsSync(xcframeworkDir)) {
      continue;
    }

    const sliceEntries = fs
      .readdirSync(xcframeworkDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("ios-"))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const sliceEntry of sliceEntries) {
      const isSimulator = sliceEntry.name.includes("simulator");
      const sliceRelDir = `$(KIRIE_EMBED_DIR)/Frameworks/${xcframeworkName}/${sliceEntry.name}`;
      const sliceAbsDir = path.join(xcframeworkDir, sliceEntry.name);
      const artifacts = fs
        .readdirSync(sliceAbsDir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const artifact of artifacts) {
        if (artifact.isDirectory() && artifact.name.endsWith(".framework")) {
          const innerFrameworkName = path.basename(artifact.name, ".framework");
          if (innerFrameworkName === "Kirie") {
            hasKirieWebViewFramework = true;
          }
          if (isSimulator) {
            simFrameworkSearchPaths.add(`"${sliceRelDir}"`);
            simLinkFlags.add(`-framework "${innerFrameworkName}"`);
          } else {
            deviceFrameworkSearchPaths.add(`"${sliceRelDir}"`);
            deviceLinkFlags.add(`-framework "${innerFrameworkName}"`);
          }
          continue;
        }

        if (artifact.isFile() && artifact.name.endsWith(".a")) {
          const libFlag = artifact.name.startsWith("lib")
            ? `-l${artifact.name.slice(3, -2)}`
            : `"${sliceRelDir}/${artifact.name}"`;
          if (isSimulator) {
            simLibrarySearchPaths.add(`"${sliceRelDir}"`);
            simLinkFlags.add(libFlag);
          } else {
            deviceLibrarySearchPaths.add(`"${sliceRelDir}"`);
            deviceLinkFlags.add(libFlag);
          }
        }
      }
    }
  }

  const systemFrameworks = [
    "AudioToolbox",
    "AVFoundation",
    "CoreAudio",
    "CoreGraphics",
    "CoreHaptics",
    "CoreMotion",
    "CoreText",
    "CoreVideo",
    "Foundation",
    "GameController",
    "IOKit",
    "IOSurface",
    "Metal",
    "MetricKit",
    "QuartzCore",
    "Security",
    "StoreKit",
    "SystemConfiguration",
    "UIKit",
    "UniformTypeIdentifiers",
    ...(hasKirieWebViewFramework
      ? ["WebKit"]
      : []),
  ]
    .map((name) => `-framework ${name}`)
    .join(" ");

  const formatList = (items: Set<string>): string =>
    items.size > 0
      ? ` ${[...items].join(" ")}`
      : "";

  return `// Generated by Kirie for iOS native host embedding.
// Bundle Resources/<ExecutableName>.pck (rename to $(EXECUTABLE_NAME).pck if needed) in Copy Bundle Resources.
KIRIE_EMBED_DIR = ${embedDir}
DEAD_CODE_STRIPPING = YES
HEADER_SEARCH_PATHS = $(inherited) "$(KIRIE_EMBED_DIR)/Sources"
FRAMEWORK_SEARCH_PATHS[sdk=iphoneos*] = $(inherited)${formatList(deviceFrameworkSearchPaths)}
FRAMEWORK_SEARCH_PATHS[sdk=iphonesimulator*] = $(inherited)${formatList(simFrameworkSearchPaths)}
LIBRARY_SEARCH_PATHS[sdk=iphoneos*] = $(inherited)${formatList(deviceLibrarySearchPaths)}
LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*] = $(inherited)${formatList(simLibrarySearchPaths)}
KIRIE_COMMON_LDFLAGS = -lc++ -lz ${systemFrameworks}
OTHER_LDFLAGS[sdk=iphoneos*] = $(inherited) $(KIRIE_COMMON_LDFLAGS)${formatList(deviceLinkFlags)}
OTHER_LDFLAGS[sdk=iphonesimulator*] = $(inherited) $(KIRIE_COMMON_LDFLAGS)${formatList(simLinkFlags)}
`;
}
