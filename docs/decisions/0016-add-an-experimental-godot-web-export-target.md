---
status: "proposed"
date: 2026-10-12
decision-makers: "LemonNeko"
consulted: "Codex, Lody"
informed: "Kirie contributors"
---

# Add an experimental Godot Web export target

## Context and Problem Statement

Godot 4.7 does not officially support exporting C# projects to the Web. Kirie
still needs a concrete way to test whether its C# wrappers, WebView ownership,
IPC lanes, and Eventa adapters can work in a browser before Godot provides that
support.

This target is a research artifact and a toy. Most of its initial
implementation was produced by AI and has not received deliberate entropy
reduction. It may contain substantial slop. Stable Kirie features must not copy
its structure without a separate design review.

This export target exists mainly because it is fun to explore, and the working
result is genuinely fun to use. That is a sufficient reason to keep the
experiment while its maintenance cost remains small.

## Decision

Add an experimental Godot Web export target to Kirie.

The C# export path uses templates derived from Godot's unfinished official
[.NET Web draft](https://github.com/godotengine/godot/pull/106125). The separate
`moeru-ai/godot-dotnet-web-templates` repository owns template builds and
releases. `kirie doctor --fix web` installs the experimental toolchain, while
`kirie export web` and `kirie dev web` expose it through the normal CLI surface.

The WebView backend remains below application protocols. One `KirieNode` owns
one same-origin iframe, and C# wrappers borrow that owner. The backend preserves
the existing `text`, `binary`, and `data` lanes. Eventa remains an adapter above
Kirie IPC.

This decision does not make Web a supported production target. It adds no
stability or compatibility promise. It does not add high-level application
APIs to GDScript, create a general JavaScript runtime, or replace the desktop,
Android, or iOS backends.

## Consequences

- Kirie can test its existing C# and Eventa design in a real browser before
  official Godot support is available.
- The experimental path depends on an unfinished upstream design and may break
  across Godot or .NET releases.
- The iframe backend adds another platform implementation that must preserve
  Kirie's ownership and lane contracts.
- Keeping template work in a separate repository prevents the main repository
  from owning template build machinery.
- The experimental code is isolated as a research path and is not a precedent
  for stable features.

## Implementation Plan

- **Affected paths**: `packages/kirie/src-godot/`, `packages/ipc/src/`,
  `packages/cli/src/commands/doctor/`, `packages/cli/src/commands/dev.ts`,
  `packages/cli/src/commands/export.ts`, and Web export examples.
- **Dependencies**: use releases from `moeru-ai/godot-dotnet-web-templates`;
  do not move their build scripts into this repository.
- **Patterns to follow**: keep `KirieNode` as the WebView owner, keep the three
  IPC lanes explicit, and keep Eventa above the low-level IPC package.
- **Patterns to avoid**: do not use this experimental implementation as a
  reference for unrelated stable features, add a second serialization path, or
  grow the iframe adapter into a JavaScript runtime library.

### Verification

- [x] `kirie doctor --fix web` installs and validates the experimental
  toolchain from the template repository.
- [x] `kirie export web` exports a C# example and packages its Web content.
- [x] `kirie dev web` prints a local URL without opening a browser.
- [x] A browser run completes bidirectional Eventa requests through the
  same-origin iframe with no runtime errors.
- [x] The iframe is removed when its owning `KirieNode` is released.

## Alternatives Considered

- Wait for official Godot .NET Web support: lower maintenance cost, but it does
  not let Kirie validate the architecture now.
- Port the C# application layer to GDScript: avoids the experimental toolchain,
  but duplicates APIs and moves application concerns into the low-level Godot
  layer.
- Use a third-party Godot fork or template: potentially faster to adopt, but it
  adds another implementation boundary and does not test the official draft.

## More Information

Revisit this decision when Godot publishes official .NET Web support or when
the maintenance cost of the experimental target exceeds its research value.
The current architecture and limitations are documented in
[`docs/architecture.md`](../architecture.md).
