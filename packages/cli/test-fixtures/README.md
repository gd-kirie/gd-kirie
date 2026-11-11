# CLI test fixtures

`project/` contains the minimal project for CLI command tests. Tests copy that directory into `.tmp/`, where module resolution uses the workspace dependencies. Test setup also copies the Kirie addon from `packages/kirie` without depending on external example repositories.

Store Kirie configuration fixtures as real `kirie.config.ts` files instead of inline TypeScript strings inside test code. The CLI imports `kirie.config.ts` from disk through Node.js native TypeScript module loading and passes `{ command, mode }` into factory exports. Real file fixtures exercise that module boundary directly and avoid string-escaping bugs. Use inline source strings only for tiny one-off generated files whose contents are not under test.
