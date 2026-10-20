---
status: "accepted"
date: 2026-08-24
decision-makers: "LemonNeko"
---

# Adopt architecture decision records

## Context and Problem Statement

Kirie makes long-lived decisions across Godot, browser TypeScript, C#, and
native platform implementations. `docs/architecture.md` describes the current
architecture, but it is not a chronological record of the alternatives and
tradeoffs behind each decision. Conversation history alone is difficult for
future contributors and coding agents to discover or treat as authoritative.

The repository needs a lightweight, version-controlled way to preserve the
reasoning behind consequential architecture decisions without turning routine
implementation work into a documentation ceremony.

## Decision

Use Architecture Decision Records under `docs/decisions/` for durable decisions
with architectural, cross-package, public-API, compatibility, or dependency
impact.

- Name ADR files `NNNN-short-title.md` and keep an index in
  `docs/decisions/README.md`.
- Use the Simple template for straightforward decisions and the MADR template
  when the decision benefits from an explicit comparison of options.
- Use the statuses `proposed`, `accepted`, `rejected`, `deprecated`, and
  `superseded`.
- Start an ADR as `proposed`; accept or reject it only after explicit review by
  the decision owner.
- Treat accepted ADRs as implementation constraints. When a decision changes,
  create a replacement ADR and mark the old record as superseded instead of
  rewriting its history.
- Consult accepted ADRs before architecture or implementation work in their
  scope.
- Pin the upstream [ADR authoring skill](https://github.com/skillrecordings/adr-skill)
  through the repository's Agent Package Manager (APM) manifest and lock file.
  Keep the generated skill installation out of Git.

ADRs do not replace issues, implementation plans, package documentation,
release documentation, or `docs/architecture.md`. Routine bug fixes, formatting
choices, and local implementation details do not require ADRs.

## Consequences

* Good, because decisions and their original tradeoffs are discoverable in the
  repository.
* Good, because contributors and coding agents have an explicit constraint to
  consult before changing affected architecture.
* Good, because the process stays proportional: only durable decisions need an
  ADR, and two template sizes are available.
* Bad, because accepted records require maintenance when a later decision
  supersedes them.
* Neutral, because current-state documentation remains authoritative for how the
  repository works now; ADRs explain why it arrived there.

## Alternatives Considered

* Conversation history only: rejected because it is not a durable,
  repository-local source of truth.
* Add all rationale to `docs/architecture.md`: rejected because current-state
  architecture and historical decisions have different maintenance needs.
* Use an external wiki or decision service: rejected because it introduces a
  second source of truth and is unnecessary for the repository's current needs.

## More Information

This convention follows Michael Nygard's description of lightweight
[architecture decision records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
and the [MADR templates](https://adr.github.io/madr/). Revisit it if the workflow
becomes burdensome or fails to preserve information needed for implementation.
