# Oxfmt SQL plugin

This crate wraps Sqruff 0.41.0 with the compatibility patches documented in
[`third_party/sqruff/README.md`](../../third_party/sqruff/README.md). Cargo pins
the patched dependency to a commit in `CarbonHQ/sqruff`; its sources are not
vendored in this repository. The patches fix parser
cache ranges, PostgreSQL `OVERLAY`, quantified/variadic arrays, and stable
layout for long SELECT targets. The adapter allows up to one million parse nodes
per document while retaining Sqruff's depth limit.
Oxfmt uses it for standalone `.sql` files by default and registers it in the shared
embedded-language dispatcher when `sql` is enabled. It works in both the native Rust
CLI and the Node binding. The default dialect is PostgreSQL; `sql.dialect` selects
another dialect, and `sql: false` disables both standalone and embedded SQL formatting.

`SqlFormatter` reuses Sqruff's dialect grammar and rule pack across a host document's
templates. A bounded cache also shares immutable linters across files with the same
options. Long-line processing indexes comment-clause tokens and ancestor paths once per
reflow pass instead of repeatedly searching the full tree. These indexes are
local to the pass and do not retain documents between formatting calls.
Only the `layout` rules run with the raw templater. Output is parsed again,
and the lexer verifies that every non-whitespace token survives in order with the same
spelling. Invalid input or a failed preservation check returns an error; the embedding
dispatcher keeps the original template.

The adapter accepts layout rule exclusions and per-syntax-type spacing and line
position settings from Oxfmt's `sql.excludeRules` and `sql.layout`. Layout settings
are part of the linter-cache key. Type names, spacing values, line positions, and
rule exclusions are validated before constructing Sqruff's configuration; only
LT01–LT15 may be excluded. These settings apply to standalone and embedded SQL.
They do not change the parser budget, raw templater, or token-preservation checks.

The JS/TS host owns tag detection, cooked template values, interpolation sentinels,
marker collision and order checks, expression formatting, and template escaping.
The SQL plugin receives SQL text and returns IR. SQL whitespace line breaks become
host-relative lines, retaining blank lines. The shared outer SQL indentation is
removed from the IR so nested templates do not accumulate indentation when LT02
is excluded. Newlines inside literals and comments remain token content.

Sqruff's supported syntax determines what can be formatted. For example, its MySQL
parser does not accept every `?` bind-parameter context; these templates are preserved.
The default PostgreSQL dialect accepts `$1` parameters, and TypeScript `${expression}`
parameters use validated identifier markers during formatting.

Run `cargo test -p oxc_formatter_sql` and `pnpm --filter oxfmt-app test test/api/sql.test.ts`
to verify the plugin and its public API integration.

For local performance measurements, build the optimized Node binding with
`pnpm --filter oxfmt-app build` and run `node apps/oxfmt/dist/cli.js --check <path>`.
`build-dev` uses unoptimized Rust and is substantially slower for Sqruff's parser
and layout rules. The first SQL file for a new configuration also initializes the
grammar; subsequent files reuse it within the process.
