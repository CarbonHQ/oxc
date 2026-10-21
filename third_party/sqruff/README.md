# Sqruff dependency and compatibility patches

The formatter uses `sqruff-lib`, `sqruff-lib-core`, and `sqruff-lib-dialects`
0.41.0 from the [CarbonHQ fork](https://github.com/CarbonHQ/sqruff/tree/codex/oxfmt).
Cargo pins all three crates to commit
`cafbdc311f9ac963880a1f383e85d18f31670a6c` in `Cargo.toml` and `Cargo.lock`.
The fork contains seven modified source files on top of upstream commit
`aa4c5730d697794ffaf72a4c187d64522e5820c7`:
https://github.com/quarylabs/sqruff/tree/aa4c5730d697794ffaf72a4c187d64522e5820c7

Only the upstream Apache-2.0 license and these provenance notes are kept here.
Cargo fetches the source when building; npm users install prebuilt native
packages and do not need Git or Rust. Both the license and these notes are
included in the main npm package and every native package.

Review the [patch commit](https://github.com/CarbonHQ/sqruff/commit/cafbdc311f9ac963880a1f383e85d18f31670a6c).

Fork changes:

- `crates/lib-core/src/parser/context.rs` and `match_algorithms.rs`: include the
  input-slice index in the parse-cache location. Cached match ranges are index
  based; sharing a source position does not make ranges interchangeable. A unit
  regression covers repeated positions at different indices.
- `crates/lib-dialects/src/postgres.rs`: parse `OVERLAY(string PLACING expression
  FROM expression [FOR expression])`, including casts and arithmetic. Also allow
  array expressions and array-returning function calls in `ANY`/`ALL`/`SOME`
  comparisons, while retaining quantified subquery support. Keep `VARIADIC`
  outside the array-literal node so layout rules preserve its keyword boundary.
- `crates/lib/src/rules/layout/lt09.rs`: keep a single SELECT target on its own
  line when combining it with SELECT would exceed `max_line_length`. This keeps
  LT09 from undoing LT05 and alternating layouts between formatter runs.

- `crates/lib/src/rules/layout/lt05.rs`: index tokens in comment clauses once
  per rule pass, avoiding a full-tree path search for every token on long lines.
  This preserves the comment-clause exemption while removing quadratic work.

- `crates/lib/src/utils/reflow/rebreak.rs` and `reindent.rs`: lazily index raw
  token ancestor paths once per reflow pass, sharing them across long lines.
  The cache is local to the pass and cannot create reference cycles in the tree.

The Oxfmt adapter separately raises the finite parse-node budget to 1,000,000;
Sqruff's depth limit remains enabled. Regressions live in
`crates/oxc_formatter_sql/src/lib.rs` and `apps/oxfmt/test/api/sql.test.ts`.
Remove these patches when a published Sqruff release includes equivalent fixes.
