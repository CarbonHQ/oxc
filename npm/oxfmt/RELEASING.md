# Publishing CarbonHQ Oxfmt

The `sql` branch publishes `@carbonhq/oxfmt`, with native packages named
`@carbonhq/oxfmt-binding-<platform>`. The CLI remains `oxfmt`. The initial
version is `0.74.0-sql.0`, distributed under the `sql` npm tag.

## Build and inspect packages

Pushes to `CarbonHQ/oxc`'s `sql` branch run
`.github/workflows/release_apps.yml`. The workflow builds every target
declared in `npm/oxfmt/package.json`, packs all native packages and the main
package, and tests a clean Linux installation. Download the
`carbonhq-oxfmt-npm` Actions artifact to inspect the tarballs. The fork reuses
Oxc's Oxfmt build matrix and publish/retry helpers in the same workflow. A branch
push does not publish anything to npm.

For a local macOS ARM64 build:

```sh
pnpm --filter oxfmt-app build
node apps/oxfmt/scripts/prepare-carbonhq-release.mjs \
  --artifacts apps/oxfmt/src-js \
  --target aarch64-apple-darwin \
  --output target/carbonhq-local
node apps/oxfmt/scripts/smoke-carbonhq-release.mjs \
  target/carbonhq-local @carbonhq/oxfmt-binding-darwin-arm64
```

Choose a fresh output directory for each run. Local `--target` builds are for
testing; the release workflow omits that option and requires all declared
binaries. The smoke test installs the tarballs into a temporary project and
checks the CLI version, standalone SQL, embedded SQL, and second-pass stability.
The main tarball contains no adjacent native binary, so the test exercises
resolution through the scoped optional dependency.

## npm access

The publisher needs permission to create public packages in the `carbonhq` npm
organization. New packages need a first authenticated publish before their
trusted publisher can be configured. For that first release, put a granular npm
token with package read/write publishing access to the `@carbonhq` scope and
Bypass 2FA enabled in `NPM_TOKEN` in the GitHub `carbonhq-npm` environment. Never commit a token or an authenticated npmrc.

After the first release, configure an npm trusted publisher on the main package
and **every native package**, using:

| Field               | Value              |
| ------------------- | ------------------ |
| GitHub organization | `CarbonHQ`         |
| Repository          | `oxc`              |
| Workflow filename   | `release_apps.yml` |
| Environment         | `carbonhq-npm`     |
| Allowed action      | `npm publish`      |

Once trusted publishing works, remove the bootstrap token. The workflow grants
`id-token: write` and publishes public packages with provenance. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for setup.

## Release a version

1. Set the same new version in `apps/oxfmt/Cargo.toml`,
   `apps/oxfmt/package.json`, and `npm/oxfmt/package.json`.
2. Rebuild the binding to regenerate `apps/oxfmt/src-js/bindings.js`, and include
   the updated `Cargo.lock`. Run the formatter tests and package smoke test.
3. Commit and push to `sql`. Confirm the build and packaging workflow passes.
4. To publish the reviewed commit, push a tag matching the package version:

   ```sh
   git tag carbonhq-oxfmt-v0.74.0-sql.0
   git push carbonhq carbonhq-oxfmt-v0.74.0-sql.0
   ```

Only the tag-triggered workflow publishes. It checks that the tag matches the
package version, publishes native packages first, then publishes the main
package. Releases use `--access public --tag sql --provenance`; they do not move
the `latest` tag. Published versions cannot be overwritten, so use a new version
for each release.

Install after publishing:

```sh
pnpm add --save-dev @carbonhq/oxfmt@sql
pnpm exec oxfmt --check .
```
