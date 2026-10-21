<p align="center">
  <br>
  <br>
  <a href="https://oxc.rs" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://oxc.rs/oxc-light.svg">
      <source media="(prefers-color-scheme: light)" srcset="https://oxc.rs/oxc-dark.svg">
      <img alt="Oxc logo" src="https://oxc.rs/oxc-dark.svg" height="60">
    </picture>
  </a>
  <br>
  <br>
  <br>
</p>

<div align="center">

[![MIT licensed][license-badge]][license-url]
[![Build Status][ci-badge]][ci-url]
[![Code Coverage][code-coverage-badge]][code-coverage-url]

[![Discord chat][discord-badge]][discord-url]
[![Playground][playground-badge]][playground-url]

[discord-badge]: https://img.shields.io/discord/1079625926024900739?logo=discord&label=Discord
[discord-url]: https://discord.gg/9uXCAwqQZW
[license-badge]: https://img.shields.io/badge/license-MIT-blue.svg
[license-url]: https://github.com/oxc-project/oxc/blob/main/LICENSE
[ci-badge]: https://github.com/oxc-project/oxc/actions/workflows/ci.yml/badge.svg?event=push&branch=main
[ci-url]: https://github.com/oxc-project/oxc/actions/workflows/ci.yml?query=event%3Apush+branch%3Amain
[npm-badge]: https://img.shields.io/npm/v/oxfmt/latest?color=brightgreen
[npm-url]: https://npmx.dev/package/oxfmt/v/latest
[code-size-badge]: https://img.shields.io/github/languages/code-size/oxc-project/oxc
[code-size-url]: https://github.com/oxc-project/oxc
[code-coverage-badge]: https://codecov.io/github/oxc-project/oxc/branch/main/graph/badge.svg
[code-coverage-url]: https://codecov.io/gh/oxc-project/oxc
[playground-badge]: https://img.shields.io/badge/Playground-blue?color=9BE4E0
[playground-url]: https://playground.oxc.rs/

</div>

# ⚓ Oxc

The Oxidation Compiler is creating a suite of high-performance tools for JavaScript and TypeScript.

## Oxfmt

`@carbonhq/oxfmt` is CarbonHQ's fork of Oxfmt with native SQL formatting.
The command is still named `oxfmt`; the package and its native bindings are
published under `@carbonhq`. Upstream Oxfmt is maintained by the Oxc contributors.

```sh
pnpm add --save-dev @carbonhq/oxfmt@sql
pnpm exec oxfmt --check .
```

To retain an existing `oxfmt` dependency name, use an npm alias such as
`yarn add --dev oxfmt@npm:@carbonhq/oxfmt@sql`.

See [release instructions](https://github.com/CarbonHQ/oxc/blob/sql/npm/oxfmt/RELEASING.md)
for building, testing, and publishing this fork.

See [usage instructions](https://oxc.rs/docs/guide/usage/formatter).

Run

- `npx --yes @carbonhq/oxfmt@sql` in your JavaScript / TypeScript codebase. No configurations are required.
- `npx @carbonhq/oxfmt@sql --help` for quick usage instructions.
- `npx skills add https://github.com/oxc-project/oxc --skill migrate-oxfmt` to install the [`migrate-oxfmt`](https://skills.sh/oxc-project/oxc/migrate-oxfmt) skill, then run `/migrate-oxfmt` to migrate from Prettier or Biome.
- See also [migrate from Prettier](https://oxc.rs/docs/guide/usage/formatter/migrate-from-prettier.html).

## SQL formatting

Standalone `.sql` files are formatted by the built-in Sqruff Rust formatter using
PostgreSQL syntax by default:

```sh
oxfmt query.sql
oxfmt --check migrations/
```

Use `sql.dialect` to select another dialect. `"sql": false` disables SQL formatting.
The CLI, stdin, Node API, and editor integration support SQL files. Invalid standalone
SQL produces a formatting error and leaves the file unchanged.

Enable embedded SQL formatting and configure the [Sqruff](https://github.com/quarylabs/sqruff)
dialect in `.oxfmtrc.json`:

```json
{ "sql": { "dialect": "postgres" } }
```

`"sql": true` uses PostgreSQL. Supported dialects are `postgres`, `ansi`, `mysql`,
`sqlite`, `bigquery`, `snowflake`, `duckdb`, and `tsql`.

The plugin formats `sql` tags (including `sql.type(schema)`), member tags such as
`Prisma.sql`, templates immediately preceded by `/* SQL */`, and SQL Markdown fences.
For example:

```ts
const query = sql`
  select
    id,
    name
  from users
  where id = ${userId}
`;
```

Only SQL layout rules run. Identifiers, literals, and comments retain their spelling,
and TypeScript expressions retain their order. The plugin uses cooked template content
and escapes it when writing the template back. SQL that Sqruff cannot parse, unsupported
interpolation contexts, and SQL inline configuration directives are preserved.

SQL formatting inherits `tabWidth`, `useTabs`, and `printWidth` from the host file.
Set `"sql": false` in a file override to disable the plugin, or set
`"embeddedLanguageFormatting": "off"` to disable all embedded formatting.

Use `sql.excludeRules` and `sql.layout` to retain an existing SQL style with
[Sqruff layout settings](https://playground.quary.dev/docs/usage/configuration/):

```json
{
  "sql": {
    "dialect": "postgres",
    "excludeRules": ["LT02", "LT05", "LT06", "LT08", "LT09"],
    "layout": {
      "function_contents": { "spacingBefore": "any" },
      "function_parameter_list": { "spacingBefore": "any" },
      "referenced_column_list": { "spacingBefore": "any" },
      "start_bracket": { "spacingBefore": "any" }
    }
  }
}
```

This preserves existing indentation (LT02), line wrapping (LT05), function spacing
(LT06), CTE separation (LT08), and SELECT-target layout (LT09). Other layout rules still run. `any` keeps
the existing spacing at the configured boundary. Type names use Sqruff's snake_case
syntax names; setting names use Oxfmt's camelCase. Per-type settings also support
`spacingAfter`, `spacingWithin`, `linePosition`, and `keywordLinePosition`.
Configure these through Oxfmt; separate `.sqruff` files are not discovered.
Rule exclusions accept only LT01–LT15, and parsing and token checks always run.
