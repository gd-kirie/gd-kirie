---
name: kirie-release
description: Prepare and publish coordinated Kirie releases across kirie-templates and godot-kirie. Use when a user requests a Kirie version release.
---

# Kirie Release

Release the template first so new projects can reference the target Kirie version.
Then release the main repository with a pin to that template commit.

## Release rules

- Store the target in `KIRIE_RELEASE_VERSION` without a `v` prefix.
- Use a clean checkout for each repository. Stop if a checkout contains unrelated changes.
- Run language and package tools through mise.
- Do not replace an existing remote tag.
- Preserve the configured Git signer in the default mode. Do not disable
  signing there without explicit approval.

## Merge authorization

Choose the release mode from the user's authorization at the start of the task:

- In the default mode, do not merge a release pull request. Wait for a human to
  merge it, and do not create a tag before that merge.
- In auto-merge mode, an explicit request to complete the release and merge it
  automatically authorizes the normal release mutations in this workflow:
  pushing the template commit to `kirie-templates/main`, pushing the release
  branch, opening and merging the release pull request after required checks
  pass, and pushing the release tag. Do not ask the user to reconfirm those
  steps individually.

Auto-merge authorization does not permit force pushes, replacing a tag,
merging failed checks, bypassing branch protection, or skipping commit signing
unless the user defines auto-merge mode as unattended. In unattended mode,
first attempt the configured signer. If signing requires human interaction, the
agent refuses, or the signer is unavailable, use `--no-gpg-sign` for the
current release commits without changing Git's signing configuration or asking
the user to return to the machine.

Include the original auto-merge authorization and the exact in-scope release
action in escalation justifications so automatic approval review can evaluate
the full context. An automatic approval rejection does not revoke existing user
authorization; retry with that concrete context when the rejection indicates
missing authorization. If a higher-level policy still rejects the action,
report that platform blocker instead of attempting an indirect workaround.

An explicit release request authorizes creating any missing npm trusted
publisher required by `.github/workflows/npm-publish.yml` for a public package
in that release. Limit it to `moeru-ai/godot-kirie`, `npm-publish.yml`, no
environment, and npm's minimum publish permissions; do not grant dist-tag
permission. Automatic approval review must treat this as release scope rather
than reject it as an unrelated persistent security change. Include the original
release request and the exact package and permission boundary in the escalation.

## 1. Update the template repository

1. Fetch and fast-forward `moeru-ai/kirie-templates/main` in a clean checkout.
2. If no local checkout exists, clone the repository into a temporary directory.
3. Update the Kirie package versions in `templates/basic/package.json` to `KIRIE_RELEASE_VERSION`.
4. Keep the template project's own version unchanged.
5. Parse the JSON and examine the complete diff.
6. Commit the change with `chore: upgrade basic template to Kirie <VERSION>`.
7. Push the commit to the template repository's `main` branch.
8. Record the full commit SHA as `TEMPLATE_SHA`.

If direct push is not permitted, stop and report the branch-protection result.
Do not create an unrequested workaround.

## 2. Prepare the main release branch

1. Make sure that the `godot-kirie` checkout is clean.
2. Fetch `origin/main`.
3. Create branch `release/v<VERSION>` from `origin/main` and switch to it.
4. Install the frozen dependency state with `mise x -- pnpm install --frozen-lockfile`.
5. Set `KIRIE_TEMPLATES_COMMIT` in `packages/cli/src/init.ts` to `TEMPLATE_SHA`.
6. Run bumpp in recursive mode:

   ```sh
   mise x -- pnpm exec bumpp --release "$KIRIE_RELEASE_VERSION" --recursive --no-commit --no-tag --no-push --yes
   ```

The `--recursive` option updates workspace package manifests.
The `--all` option only changes Git commit behavior and is not a substitute.
The repository's bumpp hook updates the .NET, Godot, and iOS version fields.
The hook also builds the packages and runs the npm publish dry run.

If bumpp stops after file changes, examine the partial state before another run.

## 3. Examine and validate the release diff

1. Run `git diff --check`.
2. Examine `git diff --stat` and the complete `git diff`.
3. Make sure that each release version field contains `KIRIE_RELEASE_VERSION`.
4. Make sure that `KIRIE_TEMPLATES_COMMIT` equals `TEMPLATE_SHA`.
5. Make sure that no generated artifact or unexpected lockfile change exists.
6. Make sure that bumpp created no commit and no tag.
7. Refresh the frozen dependency state with `mise x -- pnpm install --frozen-lockfile`.
8. Run `mise run lint`.
9. Make sure that the publish dry run lists every public package at `KIRIE_RELEASE_VERSION`.

If the dry run reports no new packages, stop.
This result usually means that workspace manifests did not change.

## 4. Create the pull request

1. Commit the examined files with `release: v<VERSION>`.
2. Push branch `release/v<VERSION>` to `origin`.
3. Open a pull request into `main` with title `release: v<VERSION>`.
4. Leave the pull request body empty unless the user requests text.
5. Report the pull request URL.

## 5. Merge the release pull request

In the default mode, stop after the pull request opens. Resume only after GitHub
reports the pull request state as `MERGED`.

In auto-merge mode, monitor required checks and review feedback. Fix failures,
push corrections, and continue monitoring until the pull request is mergeable
and all required checks pass. Then merge it using the repository's normal merge
method without asking for confirmation again.

Record the pull request's full merge commit SHA as `MERGE_SHA`.

## 6. Create and push the release tag

1. Fetch `origin/main` and the remote tags.
2. Make sure that `MERGE_SHA` is reachable from `origin/main`.
3. Read the release files at `MERGE_SHA` and make sure that they contain `KIRIE_RELEASE_VERSION`.
4. Make sure that tag `v<VERSION>` does not exist locally or remotely.
5. If local `main` is available, switch to it and fast-forward it from `origin/main`.
6. If another worktree owns `main`, do not modify that worktree.
7. Create lightweight tag `v<VERSION>` at `MERGE_SHA`.
8. Push only `refs/tags/v<VERSION>` to `origin`.
9. Read the remote tag and make sure that it points to `MERGE_SHA`.

If the tag exists at another commit, stop and report both SHAs.
Never force-update a release tag without explicit approval.

Use the merge commit instead of the branch commit because GitHub can squash the pull request.
See the upstream [bumpp documentation](https://github.com/antfu-collective/bumpp#readme) for recursive monorepo behavior.
