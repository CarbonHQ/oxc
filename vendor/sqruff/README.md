# Sqruff 0.41.0 compatibility patches

These sources come from the published `sqruff-lib`, `sqruff-lib-core`, and
`sqruff-lib-dialects` 0.41.0 crates, from upstream commit
`aa4c5730d697794ffaf72a4c187d64522e5820c7`:
https://github.com/quarylabs/sqruff/tree/aa4c5730d697794ffaf72a4c187d64522e5820c7

The workspace patches crates.io to these copies so the fixes ship with the
formatter. The upstream Apache-2.0 license is included in `LICENSE`.
Only library sources and normalized manifests are included; upstream standalone
integration fixtures, examples, and benchmarks are omitted and their manifest
targets removed. The original `.cargo_vcs_info.json` files record provenance.

Local source changes:

- `sqruff-lib-core/src/parser/context.rs` and `match_algorithms.rs`: include the
  input-slice index in the parse-cache location. Cached match ranges are index
  based; sharing a source position does not make ranges interchangeable. A unit
  regression covers repeated positions at different indices.
- `sqruff-lib-dialects/src/postgres.rs`: parse `OVERLAY(string PLACING expression
  FROM expression [FOR expression])`, including casts and arithmetic. Also allow
  array expressions and array-returning function calls in `ANY`/`ALL`/`SOME`
  comparisons, while retaining quantified subquery support. Keep `VARIADIC`
  outside the array-literal node so layout rules preserve its keyword boundary.
- `sqruff-lib/src/rules/layout/lt09.rs`: keep a single SELECT target on its own
  line when combining it with SELECT would exceed `max_line_length`. This keeps
  LT09 from undoing LT05 and alternating layouts between formatter runs.

- `sqruff-lib/src/rules/layout/lt05.rs`: index tokens in comment clauses once
  per rule pass, avoiding a full-tree path search for every token on long lines.
  This preserves the comment-clause exemption while removing quadratic work.

- `sqruff-lib/src/utils/reflow/rebreak.rs` and `reindent.rs`: lazily index raw
  token ancestor paths once per reflow pass, sharing them across long lines.
  The cache is local to the pass and cannot create reference cycles in the tree.

The Oxfmt adapter separately raises the finite parse-node budget to 1,000,000;
Sqruff's depth limit remains enabled. Regressions live in
`crates/oxc_formatter_sql/src/lib.rs` and `apps/oxfmt/test/api/sql.test.ts`.
Remove these patches when a published Sqruff release includes equivalent fixes.
