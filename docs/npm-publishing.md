# npm Publishing

This repository publishes browser-side npm packages from GitHub Actions using
npm trusted publishing. The workflow avoids long-lived npm write tokens and
lets npm issue short-lived publish credentials through GitHub Actions OIDC.

This flow is separate from addon zip publishing and the NuGet publishing lane
for .NET adapter packages.

## Current Packages

- `@gd-kirie/ipc` is published from `packages/ipc`.
- `@gd-kirie/ipc-eventa` is published from `packages/ipc-eventa`.
- `@gd-kirie/platform` is published from
  [`packages/platform`](../packages/platform/README.md).
- `@gd-kirie/tray` is published from
  [`packages/tray`](../packages/tray/README.md).
- `@gd-kirie/notifications` is published from
  [`packages/notifications`](../packages/notifications/README.md).
- `@gd-kirie/build` is published from `packages/build` as a public
  programmatic build and export API package.
- `@gd-kirie/vitest` is the ViDot launch adapter for desktop, Android, and iOS
  integration tests.
- `kirie` is the command-line owner for project initialization and development
  sessions.

`kirie` may depend on `@gd-kirie/build`, but `@gd-kirie/build` must not
depend on the CLI.

## npm Setup

The npm organization and package scope is `gd-kirie`; public JavaScript
packages include `@gd-kirie/ipc`, `@gd-kirie/ipc-eventa`,
`@gd-kirie/platform`, `@gd-kirie/tray`, `@gd-kirie/notifications`,
`@gd-kirie/build`, and `@gd-kirie/vitest`. The unscoped `kirie` package
publishes the CLI.

Configure trusted publishing for each public browser package on npmjs.com. These
fields identify the GitHub repository that is allowed to publish the package:

- Organization or user: `moeru-ai`
- Repository: `godot-kirie`
- Workflow filename: `npm-publish.yml`
- Environment name: leave empty unless the workflow is later moved behind a
  GitHub deployment environment

The package manifest must keep `repository.url` set to the GitHub repository
URL. npm validates that field during trusted publishing.

Workspace package dependencies should use `workspace:*` inside the repository;
pnpm rewrites them to published version ranges when packing or publishing.

## Release Flow

1. Run the release bump from the repository root:

   ```sh
   mise run release
   ```

   `bumpp` updates package versions, including the version used by the
   `kirie/plugin/core` descriptor, runs a package build and
   `pnpm publish -r --dry-run`, then creates a local release commit and
   `v<version>` tag.

2. Make the release commit reachable from `origin/main`, normally by merging
   the release pull request without pushing the generated tag. If the merge
   changes the commit SHA, recreate the tag on the merged `main` commit.

3. Push the `v*` tag. Release workflows reject tags whose commits are not
   reachable from `origin/main`. The `Publish npm Packages` workflow then builds
   packages, runs `pnpm publish -r --dry-run`, and publishes public workspace
   packages with `pnpm publish -r`.

Manual `workflow_dispatch` runs build and npm publish dry-run validation only.
Actual publishing is restricted to pushed release tags.

## References

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
- [GitHub Actions OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)
- [bumpp](https://github.com/antfu-collective/bumpp)
- [pnpm publish behavior](https://pnpm.io/cli/publish)
- [pnpm workspace protocol](https://pnpm.io/workspaces#workspace-protocol-workspace)
