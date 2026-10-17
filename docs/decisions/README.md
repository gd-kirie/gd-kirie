# Architecture Decision Records

Architecture Decision Records (ADRs) capture durable architecture decisions,
their context, and their consequences. They complement
`docs/architecture.md`: ADRs explain why a decision was made, while the
architecture document describes the repository's current design.

## Conventions

- Directory: `docs/decisions/`
- Naming: `NNNN-short-title.md`
- Status values: `proposed`, `accepted`, `rejected`, `deprecated`, and
  `superseded`
- Use the Simple template for straightforward decisions and the MADR template
  when comparing substantial alternatives.
- Create a new ADR as `proposed`. Change it to `accepted` or `rejected` after an
  explicit decision-owner review.
- Do not rewrite an accepted decision to describe a replacement. Add a new ADR
  and mark the old one `superseded` with a link.

ADRs are for decisions with lasting architectural or cross-package impact. They
do not replace issues, implementation plans, package READMEs, or current-state
architecture documentation.

## ADRs

- [ADR-0001: Adopt architecture decision records](0001-adopt-architecture-decision-records.md)
  — accepted, 2026-08-24
- [ADR-0002: Add system-wide global shortcuts to the Platform layer](0002-add-system-wide-global-shortcuts.md)
  — superseded by ADR-0003, 2026-08-24
- [ADR-0003: Use a low-level keyboard hook for Windows global shortcuts](0003-use-a-low-level-keyboard-hook-for-windows-global-shortcuts.md)
  — accepted, 2026-08-31
- [ADR-0004: Add macOS desktop notifications to the Platform layer](0004-add-macos-desktop-notifications.md)
  — proposed, 2026-09-18
- [ADR-0005: Add Android system Back to the Platform layer](0005-add-android-system-back-to-the-platform-layer.md)
  — accepted, 2026-09-22
- [ADR-0006: Export Platform inbound events as Eventa contracts](0006-export-platform-inbound-events-as-eventa-contracts.md)
  — accepted, 2026-09-22
- [ADR-0007: Use WinRT toasts for Windows desktop notifications](0007-use-winrt-toasts-for-windows-desktop-notifications.md)
  — proposed, 2026-09-22
- [ADR-0008: Run integration tests through ViDot and a unified Kirie launcher](0008-run-integration-tests-through-vidot-and-a-unified-kirie-launcher.md)
  — accepted, 2026-09-27
- [ADR-0009: Add system tray and menu capabilities to the Platform layer](0009-add-system-tray-and-menu-capabilities.md)
  — superseded by ADR-0012, 2026-10-04
- [ADR-0010: Introduce Kirie plugins and the core plugin](0010-introduce-kirie-plugins-and-the-core-plugin.md)
  — accepted, 2026-10-08
- [ADR-0011: Use Kirie-owned macOS status items for template icons](0011-own-macos-status-items-for-template-icons.md)
  — superseded by ADR-0013, 2026-10-10
- [ADR-0012: Extract the system tray into a Kirie plugin](0012-extract-system-tray-into-a-kirie-plugin.md)
  — superseded by ADR-0013, 2026-10-10
- [ADR-0013: Use tray-icon for the Tray plugin](0013-use-tray-icon-for-the-tray-plugin.md)
  — superseded by ADR-0015, 2026-10-11
- [ADR-0014: Extract notifications into a Kirie plugin](0014-extract-notifications-into-a-kirie-plugin.md)
  — proposed, 2026-10-10
- [ADR-0015: Load Tray through a GDExtension](0015-load-tray-through-a-gdextension.md)
  — API and lifecycle superseded by [kirie-plugins ADR-0016](https://github.com/gd-kirie/kirie-plugins/blob/main/docs/decisions/0016-forward-native-tray-and-menu-objects.md), 2026-10-12
- [ADR-0016: Add an experimental Godot Web export target](0016-add-an-experimental-godot-web-export-target.md)
  — proposed, 2026-10-12
