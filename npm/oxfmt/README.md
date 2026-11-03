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

The [CarbonHQ Sqruff fork](https://github.com/CarbonHQ/sqruff/blob/oxfmt/README.md#about-this-fork)
documents its parsing fixes, formatting stability fixes, and performance changes.

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

SQL layout rules run by default. Capitalization rules are opt-in. Quoted identifiers,
string literals, and comments retain their spelling, and TypeScript expressions retain their order. The plugin uses cooked template content
only when re-escaping it can reproduce the original raw spelling. For example, a JavaScript
Unicode escape is left untouched so tags reading `strings.raw` see the same SQL.
Line endings inside SQL literals are preserved even when layout uses CRLF.
SQL that Sqruff cannot parse, unsupported
interpolation contexts, and SQL inline configuration directives are preserved.

SQL formatting inherits `tabWidth`, `useTabs`, and `printWidth` from the host file.
Set `sql.printWidth` to give both standalone and embedded SQL their own line limit:

```json
{ "printWidth": 80, "sql": { "printWidth": 120 } }
```

SQL width includes surrounding indentation and the printed `${expression}` text.
When breaking an operator would still leave an overlong function call, its
arguments are wrapped first.
Originally one-line SQL templates stay inline when the formatted query and its
surrounding JavaScript fit `printWidth`. Multiline templates stay expanded, and SQL
layout rules can still expand a one-line query.
Multiline JavaScript interpolations follow the surrounding SQL indentation,
including tabs and alignment spaces.
Set `"sql": false` in a file override to disable the plugin, or set
`"embeddedLanguageFormatting": "off"` to disable all embedded formatting.

Set `sql.singleTargetPolicy` to `"new_line"` to put even a single SELECT target
on its own line. The default, `"same_line"`, retains Sqruff's usual behavior.
This maps to Sqruff's `single_target_policy` option for LT09 and applies to
standalone SQL and embedded SQL.

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
Rule exclusions accept LT01–LT15 and CP01–CP05. Parsing and protected-token checks always run.

All formatting settings use camelCase; syntax type names remain snake_case. Omitted
settings inherit Sqruff defaults (except LT05's comment exceptions, which default to
`true`). `tabWidth` and `useTabs` control indentation width and characters;
`sql.printWidth` controls SQL line width and falls back to `printWidth`.

| Setting                | Options                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sql.indentation`      | `indentedJoins`, `indentedJoinsOn`, `indentedCtes`, `indentedUsingOn`, `indentedOnContents`, `indentedThen`, `indentedThenContents`                                               |
| Indentation behavior   | `implicitIndents` (`forbid`, `allow`, `require`), `hangingIndents`, `templateBlocksIndent`, `trailingComments` (`before`, `after`), `ignoreCommentLines`                          |
| Indentation exclusions | `skipIndentationIn`, `skipImplicitIndentsIn` (arrays of syntax type names; empty arrays clear defaults)                                                                           |
| `sql.longLines`        | `ignoreCommentLines`, `ignoreCommentClauses`                                                                                                                                      |
| `sql.wildcardPolicy`   | `single` or `multiple` for LT09                                                                                                                                                   |
| `sql.newlines`         | `minimumEmptyLinesBetweenStatements`, `maximumEmptyLinesBetweenStatements`, `maximumEmptyLinesInsideStatements`, `maximumEmptyLinesBetweenBatches`                                |
| `sql.layout.<type>`    | `spacingBefore`, `spacingAfter`, `spacingWithin`, `linePosition`, `keywordLinePosition`, `keywordLinePositionExclusions`, `alignWithin`, `alignScope`, `alignmentCoordinateSpace` |
| `sql.capitalization`   | Separate `keywords`, `identifiers`, `functions`, `literals`, and `types` objects                                                                                                  |

The minimum blank lines between statements must be between 0 and 16. Formatting
reports an error if it would synthesize more than 16,384 newline segments in one document.

Spacing accepts `single`, `touch`, `any`, `single:inline`, `touch:inline`, `align`,
and Sqruff's `align:type:within:scope:source` compact syntax. Alignment coordinate
space is `source` or `templated`. Line positions accept `leading`, `trailing`, or
`alone` and Sqruff's `strict`, `attached`, and `align-following` modifiers;
`keywordLinePosition` also accepts `none`.

Use `implicitIndents: "allow"` to retain a clause's first item on the keyword's
line while indenting continuation lines. `require` collapses the initial break;
`forbid` requires explicit breaks where the grammar's indentation scope spans lines.
PostgreSQL INSERT targets, VALUES rows, FILTER predicates, partial-index predicates,
statistics, role/extension/storage options, grants, and policy clauses all have
indentation scopes, so LT02 can enforce the chosen `tabWidth` there.

Each capitalization object accepts `policy`, `ignoreWords`, and `ignoreWordsRegex`
(arrays; regexes use Rust syntax). Policies are `consistent`, `upper`, `lower`,
`capitalise`; identifiers, functions, and types additionally support `pascal`,
`camel`, and `snake`. Transformations that add/remove characters are rejected by
the token guard. Identifiers additionally accept `unquotedIdentifiersPolicy`:
`all`, `none`, `aliases`, `column_aliases`, or `table_aliases`.

```json
{
  "sql": {
    "indentation": {
      "implicitIndents": "allow",
      "indentedJoins": true,
      "indentedCtes": true
    },
    "capitalization": {
      "keywords": { "policy": "lower" },
      "types": { "policy": "lower", "ignoreWords": ["MyCustomType"] }
    }
  }
}
```

Only configured capitalization targets run. No aliasing, quoting, reference,
convention, structural rewrite, templater, or parser-budget settings are exposed.
