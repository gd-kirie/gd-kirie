# AGENTS

This file contains repository-specific constraints for agents. It is not a
project overview, roadmap, package catalog, or coverage tracker.

Use the human-facing sources of truth instead:

- `README.md` for installation and repository entry points
- `docs/architecture.md` for current architecture and design rationale
- `docs/decisions/README.md` for accepted architecture decisions and their
  rationale
- `docs/platform-integration-tests.md` for integration-test responsibilities
- `docs/addon-release.md`, `docs/npm-publishing.md`, and
  `docs/nuget-publishing.md` for release operations
- package READMEs for package installation and usage
- `docs/references.md` for primary technical sources

Do not duplicate those documents here.

## Architecture Boundaries

- Keep `addons/kirie` and `@gd-kirie/ipc` as low-level WebView and IPC layers.
  Application protocols and capabilities belong in packages above them.
- Keep Eventa adapters outside `addons/kirie`. JSON is an adapter encoding, not
  a Kirie core payload format.
- Preserve the Platform dependency direction:
  `@gd-kirie/platform -> @gd-kirie/ipc-eventa -> @gd-kirie/ipc` and
  `GdKirie.Platform -> GdKirie.EventaAdapter`.
- Preserve the Tray plugin dependency direction:
  `@gd-kirie/tray -> @gd-kirie/ipc-eventa -> @gd-kirie/ipc` and
  `GdKirie.Tray.EventaAdapter -> GdKirie.Tray` and
  `GdKirie.Tray.EventaAdapter -> GdKirie.EventaAdapter`.
  Keep the native C# Tray SDK independent of Eventa and browser IPC.
- Platform packages and the Tray Eventa adapter must borrow the application's
  Eventa context. They must not create a competing IPC or Eventa owner.
- Keep Uninvoke-specific APIs, wire names, compatibility behavior, and errors in
  the Uninvoke adapter rather than the Kirie Platform contract.
- Do not introduce a general `BrowserWindow` facade or add application
  capability APIs to GDScript.
- Treat `KirieNode` as the scene-tree owner of one platform WebView. C# wrappers
  may borrow that owner but must not create a second WebView owner implicitly.
- Keep Godot-facing wrappers thin. Native lifecycle behavior belongs in the
  platform implementation, not duplicated in GDScript or C#.
- Keep the Kirie IPC lanes explicit: `text`, `binary`, and `data` over CBOR.
  Do not restore automatic JSON serialization or add a GDScript CBOR codec.
- Preserve the cross-platform data subset documented in
  `docs/architecture.md`; do not expose engine-local or language-local objects
  through the data lane.
- Keep packaged production web content at `res://src-web/dist/index.html`.
  Do not restore `res://web` as a compatibility path.

## Native Platform Boundaries

- Android browser transport uses AndroidX WebKit ArrayBuffer channels; Android
  native CBOR uses Jackson. Do not replace this with a JavaScript interface or
  a second serialization path.
- iOS carries the same CBOR packets as base64 WKWebView script messages. Bind
  native Godot methods and signals through ClassDB; do not add a hand-written
  dispatch or callback registry.
- Desktop Godot CEF is a backend for Kirie's existing public surface. Do not
  expose the full Godot CEF API through Kirie.
- Keep the public addon rooted at `addons/kirie`. Do not add Capacitor-style
  project-local `ios/` or `android/` native projects.
- Keep Android and iOS release artifacts in the addon paths documented in
  `docs/addon-release.md`; do not restore project-local iOS `.gdip` shims.
- Keep UI-bound WebView operations on the platform UI thread or main actor.

## Public API Constraints

- Preserve the low-level Kirie lane API across GDScript, C#, browser, and
  native implementations. Do not rename public methods, signals, or exported
  properties without a concrete requirement.
- When a public API changes, update its package README, example, and relevant
  architecture note in the same change.
- Keep TypeScript and C# Platform wire IDs and payload semantics aligned.
- Expose Kirie signals as idiomatic C# events; keep `Callable` details private.
- Reject unsupported required configuration at its boundary. Runtime commands
  must not silently repair `project.godot` or `export_presets.cfg`.
- Godot-owned configuration repairs must be explicit and performed through
  Godot APIs such as `ProjectSettings` or `ConfigFile`, not text patching.

## Type and Style

- Prefer type inference in GDScript, TypeScript, Kotlin, and Swift when the
  inferred type is stable and obvious.
- Use `snake_case` for variables, parameters, functions, methods, and fields in
  `src-godot` TypeScript. Keep class and type names in PascalCase and preserve
  external API names.
- Leave a blank line after control-flow blocks in `src-godot` TypeScript, and
  separate unrelated steps within a function with blank lines.
- Write explicit key-value pairs in `src-godot` object literals. The current
  TypeScript-to-GDScript converter drops shorthand fields.
- Prefer TypeScript `instanceof` narrowing over `gd.as` in `src-godot`. Keep
  `gd.as` where the generated GDScript needs an explicit runtime cast; plain
  TypeScript `as` assertions are erased by the converter.
- Prefer current stable language syntax supported by the repository toolchain
  when it improves type clarity or reduces boilerplate without hurting
  readability.
- Do not add redundant explicit types to short local variables just to satisfy a
  style preference.
- Keep public APIs, cross-language boundaries, exported properties, signal
  payloads, and bridge-facing types explicit when that improves readability.
- For TypeScript object shapes, prefer `interface` over `type`. Keep `type` for
  unions, intersections, mapped types, conditional types, and other aliases that
  are not simple object shapes. This is enforced by ESLint's
  `ts/consistent-type-definitions` rule.
- Prefer idiomatic C# events on public C# wrappers instead of exposing raw Godot
  signal connection details to C# users.
- Prefer `val` over `var` in Kotlin unless mutation is required.
- Prefer `let` over `var` in Swift unless mutation is required.
- Prefer early returns and early continues to keep control flow flat. Avoid
  nesting conditionals when a guard clause or loop `continue` can handle the
  exceptional or irrelevant case clearly.
- Avoid suppressing compiler, linter, or deprecation warnings. Use suppression
  only when the current platform or compatibility target temporarily requires an
  older API and the modern API is already used where available.
- For JavaScript and TypeScript in this repo, avoid unnecessary `void` usage to
  swallow async promises and avoid unnecessary dynamic imports.
- For JavaScript and TypeScript callbacks, prefer eta reduction when the wrapper
  does not adapt arguments, bind context, add control flow, or improve
  readability.

## Simplicity and Abstraction

- Do not introduce abstractions for hypothetical future needs.
- Let real repetition and confirmed requirements justify shared layers.
- Prefer small, local duplication over premature shared abstractions.
- Do not create vague `utils`, `helpers`, `common`, or `shared` modules without
  a clear domain-specific reason.
- Do not wrap platform APIs with thin pass-through helpers unless the wrapper
  stabilizes the public API, hides a platform difference, or creates a useful
  test seam.
- Do not add guard code, helper functions, quoting layers, duplicate logs, or
  wrapper messages merely to beautify errors. Prefer the underlying error unless
  handling it changes behavior or materially improves a likely failure.
- Keep logic close to the module that owns it instead of extracting
  cross-cutting helpers early.
- Add configuration, extension points, and generic options only for confirmed
  use cases.
- Remove speculative or superseded structure instead of retaining it for later.
- When a same-session decision is replaced, converge on the latest decision;
  do not add compatibility unless the user requires it.

## Dependencies

- Prefer platform APIs and small foundational libraries over large framework
  additions.
- Add a dependency only when it materially reduces risk or complexity.
- Prefer the latest stable version unless a documented compatibility constraint
  requires another version.
- Keep browser-side runtime dependencies light.

## Tooling

- Run repository tools through mise: `mise x -- <command>` or an existing
  `mise run <task>` entry point.
- Install or refresh project tools with `mise install`.
- Use `mise x -- godot <command>` for Godot and `mise which godot` only when a
  direct executable path is required.
- Do not replace the configured Godot mise backend with an ad hoc download or
  `http` tool definition.
- Keep Gradle wrapper and Xcode invocation in their existing build paths; mise
  provides the surrounding toolchain rather than replacing them.
- Start commands with the fewest necessary flags and add options only for a
  concrete need.
- Use the existing native artifact tasks:
  `mise run build:android-aar`, `mise run build:ios-xcframework`, and
  `mise run build:native-artifacts`.
- Use `mise run build:addon-pack` to build the public addon archive and
  `mise run check:addon-pack` to validate an already staged addon tree.
- Use `mise run test:integration-desktop`, `mise run test:integration-android`,
  and `mise run test:integration-ios` for platform integration suites.
- Keep repository task TypeScript executable by Node's built-in type stripping.
  Do not add a TypeScript runtime loader or non-erasable syntax to
  `scripts/build*.ts` or `scripts/run-build-task.js`.

## Validation

- Run the relevant lint task after changing a covered language:
  - TypeScript, JSON, CSS, and HTML: `mise run lint:eslint`
  - Kotlin and Gradle Kotlin DSL: `mise run lint:kotlin`
  - Swift: `mise run lint:swift`
- Run `mise run lint` for broad, multi-language changes.
- Use the matching formatter for style-only edits: `mise run format:eslint`,
  `mise run format:kotlin`, or `mise run format:swift`.
- Edit addon GDScript through `packages/kirie/src-godot` and regenerate with
  `mise x -- pnpm -C packages/kirie run generate:godot`. Validate generated
  scripts with Godot when changing their behavior.
- After Android native changes, run `mise run build:android-aar` before exported
  integration tests.
- After iOS native changes, run `mise run build:ios-xcframework` before device
  testing.
- After changing IPC behavior, exercise at least one real request/response path
  through `examples/basic-ipc` or `tests/integration`.
- Compile changes to `KirieClient` against the Godot .NET SDK.
- Test supported behavior and realistic regressions. Do not add tests that only
  assert constants, language behavior, or a forbidden implementation pattern.

## Repository Hygiene

- Do not commit generated `.aar`, `.xcframework`, exported application bundles,
  `dist/` staging output, or other build artifacts unless the repository first
  adopts that artifact class as source-distributed content.
- Do not hand-edit generated files. If no generator exists and a temporary edit
  is explicitly requested, mark it clearly and record the missing source.
- Keep IPC logs direction-aware and request/response correlation IDs explicit.
- Be explicit about readiness and lifecycle transitions before sending bridge
  messages.
- Use English for repository documentation, agent notes, and agent-to-agent
  communication unless the user requests a non-English artifact.
- Avoid the bridge metaphor `envelope` or `envelop` in new Kirie APIs, comments,
  and documentation unless naming an upstream type such as Eventa's
  `EventEnvelope`.
- Cite an official document or upstream repository for non-trivial API,
  compatibility, dependency, or native-platform decisions. Treat community
  discussion as supplemental evidence.
- Pull request and commit titles use Conventional Commits-style subjects.

## Template Pin Check

On the first assistant reply of a new session and at least once every ten
assistant replies thereafter, compare the default branch commit of
`moeru-ai/kirie-templates` with `KIRIE_TEMPLATES_COMMIT` in
`packages/cli/src/commands/init.ts`. If they differ, report both SHAs; never update the
pin automatically.
