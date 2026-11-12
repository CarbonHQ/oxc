# Carbon Oxfmt SQL for VS Code

A tiny companion that activates the official Oxc extension when you open SQL.
All formatting runs through the official extension's existing language server
connection. The companion has no formatter, subprocess, configuration, or document
synchronization logic of its own.

The CarbonHQ fork registers SQL formatting and open/change/close notifications via
LSP dynamic registration. This extends the official extension's document selectors
and ensures the server receives unsaved edits, including untitled SQL buffers.
VS Code's **MS SQL** language mode uses the `sql` language ID and is supported.

## Install and configure

This needs a build of the fork containing SQL dynamic registration. The previously
published `0.76.0-sql.0` package does not include it. Merely installing this
companion with that older binary will not enable SQL formatting.

From the repository root, build the fork:

```sh
pnpm --filter oxfmt-app build-dev
```

Package the companion:

```sh
cd editors/vscode-sql
npm run package
code --install-extension oxfmt-sql-0.2.0.vsix
```

Alternatively, use **Extensions: Install from VSIX**. The official `oxc.oxc-vscode`
extension is a required dependency. Reload VS Code after installation if prompted.
Packaging uses Microsoft's pinned `@vscode/vsce` packager through npm and needs
network access on the first run. It does not publish to the Marketplace.

In your project's `.vscode/settings.json`, select the **official** formatter and
point it to the rebuilt fork:

```json
{
  "oxc.path.oxfmt": "/absolute/path/to/oxc-sql/apps/oxfmt/dist/cli.js",
  "[sql]": {
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true
  }
}
```

Run **Oxc: Restart oxfmt Server** after changing the binary. Once a newer fork is
published, an `oxfmt` npm alias to that release can use the official extension's
normal package discovery instead of `oxc.path.oxfmt`.

The companion does not appear as a formatter in **Format Document With…**; select
**Oxc**. If you used the previous companion, replace `carbonhq.oxfmt-sql` with
`oxc.oxc-vscode` in your formatter settings and remove `carbonSqlFormatter.*`
settings. This also means the official extension's Oxfmt enable/disable and restart
commands control SQL formatting.

## Configuration

Use the existing Oxc extension settings for Node, binary selection, configuration,
and logging. All formatting options remain in your project's Oxfmt configuration.
The SQL language mode does not select a dialect. For SQL Server, for example:

```json
{ "sql": { "dialect": "tsql" } }
```

The fork defaults to PostgreSQL. Its LSP handles nested config, `.editorconfig`,
ignore rules, minimal text edits, and invalid SQL in the same way as other
supported languages. SQL dynamic registration is sent only when the client
supports both dynamic formatting and document synchronization. Clients without
these capabilities keep their existing behavior and must register SQL themselves.

## GitHub releases

The `Release SQL VS Code Extension` workflow packages and publishes a VSIX when a
`carbonhq-oxfmt-sql-vscode-v*` tag is pushed to `CarbonHQ/oxc`. The tag version must
match `version` in `editors/vscode-sql/package.json`.

After committing the extension and workflow, release the current version with:

```sh
git tag carbonhq-oxfmt-sql-vscode-v0.2.0
git push carbonhq carbonhq-oxfmt-sql-vscode-v0.2.0
```

Download `oxfmt-sql-0.2.0.vsix` from that GitHub release and install it using
**Extensions: Install from VSIX**. The workflow uses `GITHUB_TOKEN`; no Marketplace
credentials are needed. The VSIX contains only the companion, so the formatter
fork still needs to be installed separately as described above.

## Development

No compilation or npm dependencies are needed for the companion. To try it without
installing, run this from the repository root:

```sh
code --extensionDevelopmentPath="$PWD/editors/vscode-sql" /path/to/project
```

Server registration and SQL synchronization are covered by the language server's
Rust tests and the Oxfmt LSP integration tests:

```sh
cargo test -p oxc_language_server -p oxfmt --all-features
pnpm --filter oxfmt-app build-dev
pnpm --filter oxfmt-app exec vitest run test/lsp
```
