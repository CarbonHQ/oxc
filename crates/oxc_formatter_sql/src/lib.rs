//! SQL formatting plugin backed by Sqruff's Rust library.
//!
//! Layout rules run by default; capitalization rules are opt-in. Comments,
//! quoted literals and quoted identifiers survive unchanged; input containing parse errors or inline configuration is rejected.

mod config;
mod options;

pub use config::{validate_capitalization, validate_newlines, validate_syntax_names};
pub use options::*;
pub use sqruff_lib_core::parser::segments::LayoutContext as SqlRenderContext;

use std::{
    collections::BTreeMap,
    num::{NonZeroU8, NonZeroU32},
    sync::{Arc, Mutex},
};

use cow_utils::CowUtils;
use oxc_allocator::ArenaVec;
use oxc_diagnostics::{LabeledSpan, OxcDiagnostic};
use oxc_formatter_core::{
    Align, CoreFormatOptions, Document, EmbeddedIr, FormatElement, FormatOptions, FormatSession,
    InputKind, Tag, format_element::LineMode,
};
use sqruff_lib::core::linter::core::Linter;
use sqruff_lib_core::{
    dialects::syntax::SyntaxKind,
    errors::SQLBaseError,
    parser::segments::{ErasedSegment, Tables},
};

fn parse_diagnostic(
    source_text: &str,
    dialect: &str,
    error: Option<&SQLBaseError>,
) -> OxcDiagnostic {
    // Sqruff parse errors provide character-based line/column positions, but
    // their source slices can be empty. Oxc labels use UTF-8 byte offsets.
    let offset = error.map_or(0, |error| {
        let line_start = source_text
            .split_inclusive('\n')
            .take(error.line_no.saturating_sub(1))
            .map(str::len)
            .sum::<usize>();
        let column = source_text[line_start..]
            .split('\n')
            .next()
            .unwrap_or_default()
            .chars()
            .take(error.line_pos.saturating_sub(1))
            .map(char::len_utf8)
            .sum::<usize>();
        line_start + column
    });
    let len = source_text[offset..].chars().next().map_or(0, char::len_utf8);
    let description = error.map_or("Unparsable section", SQLBaseError::desc);
    let mut diagnostic = OxcDiagnostic::error(format!("Unable to parse SQL ({dialect}): {description}"))
        .with_help("Check sql.dialect in your Oxfmt configuration. Valid SQL may use syntax unsupported by Sqruff.");
    if let (Ok(offset), Ok(len)) = (u32::try_from(offset), u32::try_from(len)) {
        diagnostic = diagnostic.with_label(LabeledSpan::new(None, offset, len));
    }
    diagnostic
}

/// Options inherited from the host document, plus the SQL dialect.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SqlFormatOptions {
    pub core: CoreFormatOptions,
    /// A dialect supported by Sqruff (the Oxfmt configuration validates this name).
    pub dialect: &'static str,
    /// Formatting-only Sqruff configuration. Parsing and protected-token checks stay enabled.
    pub settings: SqlLayoutSettings,
}

/// Optional overrides for Sqruff's formatting rules.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SqlLayoutSettings {
    pub indentation: SqlIndentationSettings,
    pub long_lines: SqlLongLineSettings,
    pub wildcard_policy: Option<SqlWildcardPolicy>,
    pub newlines: SqlNewlineSettings,
    pub capitalization: SqlCapitalizationSettings,
    /// Formatting rule codes to exclude (LT01–LT15 and CP01–CP05).
    pub exclude_rules: Vec<String>,
    /// Placement of a SELECT clause containing one target.
    pub single_target_policy: Option<&'static str>,
    /// Per-syntax-type spacing and line positioning.
    pub types: BTreeMap<String, SqlLayoutTypeSettings>,
}

/// Positioning options for one Sqruff syntax node type.
#[derive(Clone, Debug, Default, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlLayoutTypeSettings {
    pub keyword_line_position_exclusions: Option<Vec<String>>,
    pub align_within: Option<String>,
    pub align_scope: Option<String>,
    pub alignment_coordinate_space: Option<String>,
    /// Spacing before this node.
    pub spacing_before: Option<String>,
    /// Spacing after this node.
    pub spacing_after: Option<String>,
    /// Spacing within this node.
    pub spacing_within: Option<String>,
    /// Position of the whole node: leading, trailing, or alone.
    pub line_position: Option<String>,
    /// Position of its leading keyword: leading, trailing, or alone.
    pub keyword_line_position: Option<String>,
}

/// Whether a name is a Sqruff syntax type usable in layout configuration.
pub fn is_layout_type(name: &str) -> bool {
    name.parse::<SyntaxKind>().is_ok()
}

fn linter(options: &SqlFormatOptions) -> Result<Arc<Linter>, OxcDiagnostic> {
    // Grammar/rule setup is expensive even for a tiny query. Share immutable
    // linters across files and API calls, with a bounded number of configurations.
    static CACHE: Mutex<Vec<(SqlFormatOptions, Arc<Linter>)>> = Mutex::new(Vec::new());
    let mut cache = CACHE.lock().expect("SQL formatter cache poisoned");
    if let Some((_, linter)) = cache.iter().find(|(key, _)| key == options) {
        return Ok(Arc::clone(linter));
    }
    let linter = Arc::new(build_linter(options)?);
    if cache.len() == 8 {
        cache.remove(0);
    }
    cache.push((options.clone(), Arc::clone(&linter)));
    Ok(linter)
}

fn build_linter(options: &SqlFormatOptions) -> Result<Linter, OxcDiagnostic> {
    config::build_linter(options)
}

fn format_and_lex(
    source_text: &str,
    layout: SqlRenderContext,
    linter: &Linter,
    dialect: &str,
    preserve_indentation: bool,
    allow_case_changes: bool,
) -> Result<(Vec<ErasedSegment>, usize), OxcDiagnostic> {
    // Sqruff inline directives can replace the formatting rule set, change the
    // dialect, or invoke a templater. They are SQL content in this plugin.
    if source_text.lines().any(|line| {
        let line = line.trim_start();
        line.starts_with("-- sqruff:") || line.starts_with("-- sqlfluff:")
    }) {
        return Err(OxcDiagnostic::error("SQL inline configuration is not supported"));
    }
    let result = linter
        .lint_string_with_layout(source_text, None, true, layout)
        .map_err(|error| OxcDiagnostic::error(error.to_string()))?;
    if result.has_parse_or_templating_errors() {
        let error = result.violations().iter().find(|error| {
            error.rule.is_none() || matches!(error.rule_code(), "PRS" | "LXR" | "TMP")
        });
        return Err(parse_diagnostic(source_text, dialect, error));
    }
    let formatted = result.fix_string();
    let tables = Tables::default();
    let parsed = linter
        .parse_string(&tables, &formatted, None)
        .map_err(|error| OxcDiagnostic::error(error.to_string()))?;
    if !parsed.violations.is_empty() {
        return Err(OxcDiagnostic::error("Formatted SQL does not parse"));
    }
    let lexer = linter.config().get_dialect().lexer();
    let (before, before_errors) = lexer.lex(&tables, source_text);
    let (after, after_errors) = lexer.lex(&tables, formatted.as_str());
    if !before_errors.is_empty() || !after_errors.is_empty() {
        return Err(OxcDiagnostic::error("Unable to lex SQL"));
    }
    // Allow whitespace and explicitly enabled case changes. In particular,
    // no lint fix may add aliases, change quotes, or rewrite a SQL literal.
    let mut before_tokens = before.iter().filter(|segment| !segment.is_whitespace());
    let mut after_tokens = after.iter().filter(|segment| !segment.is_whitespace());
    loop {
        match (before_tokens.next(), after_tokens.next()) {
            (None, None) => break,
            (Some(before), Some(after))
                if before.get_type() == after.get_type()
                    && (before.raw() == after.raw()
                        || (allow_case_changes
                            && before
                                .raw()
                                .chars()
                                .all(|c| c.is_alphanumeric() || matches!(c, '_' | '$'))
                            && before.raw().cow_to_lowercase()
                                == after.raw().cow_to_lowercase())) => {}
            _ => return Err(OxcDiagnostic::error("SQL formatting changed protected tokens")),
        }
    }
    // LT13 can remove the first line's margin even when LT02 is disabled.
    // Measure the original layout in that case, before the first line is trimmed.
    let margin = layout_margin(if preserve_indentation { &before } else { &after });
    Ok((after, margin))
}

/// Format SQL into the host's IR, preserving literal-internal newlines.
///
/// # Errors
/// Returns an error on invalid SQL or a transformation that changes SQL tokens.
pub fn format_to_ir<'a>(
    session: &FormatSession<'a>,
    source_text: &str,
    options: SqlFormatOptions,
) -> Result<EmbeddedIr<'a>, OxcDiagnostic> {
    SqlFormatter::new(options)?.format_to_ir(session, source_text)
}

// A template's cooked SQL includes the host indentation. Remove only the shared
// SQL whitespace margin when producing relative IR. Newlines inside literals and
// comments are token content, so they must not influence or lose that margin.
fn layout_margin(segments: &[ErasedSegment]) -> usize {
    let mut margin = None;
    let mut indent = 0;
    let mut line_start = true;
    for segment in segments {
        let raw = segment.raw();
        if raw.is_empty() {
            continue;
        }
        if segment.is_whitespace() {
            if let Some((_, tail)) = raw.rsplit_once('\n') {
                line_start = true;
                indent = tail.bytes().take_while(|byte| matches!(byte, b' ' | b'\t')).count();
            } else if line_start {
                indent += raw.bytes().take_while(|byte| matches!(byte, b' ' | b'\t')).count();
            }
        } else {
            if line_start {
                margin = Some(margin.map_or(indent, |old: usize| old.min(indent)));
            }
            line_start = false;
        }
    }
    margin.unwrap_or(0)
}

/// Reusable SQL plugin instance: dialect grammars and the rule pack are built
/// once per host configuration, then shared by all embedded templates.
pub struct SqlFormatter {
    options: SqlFormatOptions,
    linter: Arc<Linter>,
}

impl SqlFormatter {
    /// Construct the layout-only formatter.
    ///
    /// # Errors
    /// Returns an error for an unsupported dialect or invalid Sqruff configuration.
    pub fn new(options: SqlFormatOptions) -> Result<Self, OxcDiagnostic> {
        let linter = linter(&options)?;
        Ok(Self { options, linter })
    }

    /// Format SQL into an embedded document.
    ///
    /// # Errors
    /// Returns an error for invalid SQL or a transformation that changes SQL tokens.
    pub fn format_to_ir<'a>(
        &self,
        session: &FormatSession<'a>,
        source_text: &str,
    ) -> Result<EmbeddedIr<'a>, OxcDiagnostic> {
        self.format_to_ir_with_context(session, source_text, SqlRenderContext::default())
    }

    /// Format embedded SQL using the host's actual interpolation widths.
    ///
    /// # Errors
    /// Returns an error for invalid SQL or a transformation that changes SQL tokens.
    pub fn format_to_ir_with_context<'a>(
        &self,
        session: &FormatSession<'a>,
        source_text: &str,
        mut layout: SqlRenderContext,
    ) -> Result<EmbeddedIr<'a>, OxcDiagnostic> {
        let options = &self.options;
        layout.tab_width = usize::from(options.core.indent_width.value());
        let (segments, margin) = format_and_lex(
            source_text,
            layout,
            &self.linter,
            options.dialect,
            options.settings.exclude_rules.iter().any(|rule| rule == "LT02"),
            options.settings.capitalization.is_enabled(),
        )?;
        let allocator = session.allocator();
        let mut ir = ArenaVec::new_in(&allocator);
        let mut remaining_margin = 0;
        let mut line_breaks = 0;
        let mut line_indent = 0;
        let mut indentation = IrIndentation::default();
        // The host supplies the outer newlines. SQL token content is never trimmed.
        let first = segments
            .iter()
            .position(|segment| !segment.is_whitespace() && !segment.raw().is_empty());
        let last = segments
            .iter()
            .rposition(|segment| !segment.is_whitespace() && !segment.raw().is_empty());
        if let (Some(first), Some(last)) = (first, last) {
            for segment in &segments[first..=last] {
                let raw = segment.raw();
                if segment.is_whitespace() {
                    for part in raw.split_inclusive('\n') {
                        if part.ends_with('\n') {
                            line_breaks += 1;
                            line_indent = 0;
                            remaining_margin = margin;
                        } else {
                            let remove = part
                                .bytes()
                                .take_while(|byte| matches!(byte, b' ' | b'\t'))
                                .count()
                                .min(remaining_margin);
                            remaining_margin -= remove;
                            let text = &part[remove..];
                            if line_breaks > 0 {
                                line_indent += text
                                    .bytes()
                                    .map(|byte| {
                                        if byte == b'\t' {
                                            usize::from(options.core.indent_width.value())
                                        } else {
                                            1
                                        }
                                    })
                                    .sum::<usize>();
                            } else if !text.is_empty() {
                                let text = allocator.alloc_str(text);
                                ir.push(FormatElement::text(text, options.core.indent_width));
                            }
                        }
                    }
                } else if !raw.is_empty() {
                    if let Some(count) = NonZeroU32::new(line_breaks) {
                        indentation.set(line_indent, options.core.indent_width.value(), &mut ir);
                        ir.push(FormatElement::Line(LineMode::ExactLineBreaks(count)));
                        line_breaks = 0;
                    }
                    remaining_margin = 0;
                    let text = allocator.alloc_str(raw);
                    ir.push(FormatElement::literal_text(text, options.core.indent_width));
                }
            }
        }
        indentation.set(0, options.core.indent_width.value(), &mut ir);
        Ok(EmbeddedIr { ir })
    }
}

/// SQL indentation must be structural so a host interpolation inherits the
/// indentation of its SQL line when the host expression itself breaks.
#[derive(Default)]
struct IrIndentation {
    levels: usize,
    align: u8,
}

impl IrIndentation {
    fn set(&mut self, columns: usize, width: u8, ir: &mut ArenaVec<'_, FormatElement<'_>>) {
        // Zero is a valid host indent width: it emits no indentation.
        if width == 0 {
            return;
        }
        let levels = columns / usize::from(width);
        let align = u8::try_from(columns % usize::from(width)).unwrap();
        if self.levels == levels && self.align == align {
            return;
        }
        if self.align > 0 {
            ir.push(FormatElement::Tag(Tag::EndAlign));
        }
        for _ in levels..self.levels {
            ir.push(FormatElement::Tag(Tag::EndIndent));
        }
        for _ in self.levels..levels {
            ir.push(FormatElement::Tag(Tag::StartIndent));
        }
        if let Some(count) = NonZeroU8::new(align) {
            ir.push(FormatElement::Tag(Tag::StartAlign(Align::new(count))));
        }
        self.levels = levels;
        self.align = align;
    }
}

/// Format SQL as a standalone document.
///
/// # Errors
/// Returns an error on invalid SQL or a transformation that changes SQL tokens.
pub fn format(source_text: &str, options: SqlFormatOptions) -> Result<String, OxcDiagnostic> {
    let allocator = oxc_allocator::Allocator::default();
    let session = FormatSession::new(&allocator, InputKind::PhysicalFile);
    let core = options.core;
    let embedded = format_to_ir(&session, source_text, options)?;
    let mut ir = embedded.ir;
    ir.push(FormatElement::Line(LineMode::Hard));
    Document::new(ir, vec![])
        .print(source_text.len(), core.as_print_options())
        .map(oxc_formatter_core::Printed::into_code)
        .map_err(|error| OxcDiagnostic::error(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(dialect: &'static str) -> SqlFormatOptions {
        SqlFormatOptions {
            core: CoreFormatOptions::default(),
            dialect,
            settings: SqlLayoutSettings::default(),
        }
    }

    #[test]
    fn only_changes_layout() {
        let source = "select  a,b from users where id=1;";
        let output = format(source, options("postgres")).unwrap();
        assert_eq!(output, "select\n  a,\n  b\nfrom users\nwhere id = 1;\n");
        assert_eq!(format(&output, options("postgres")).unwrap(), output);
    }

    #[test]
    fn single_target_policy_is_stable_and_has_its_own_cache_entry() {
        let source = "select a from users;";
        let defaults = format(source, options("postgres")).unwrap();
        assert_eq!(defaults, "select a from users;\n");
        let mut configured = options("postgres");
        configured.settings.single_target_policy = Some("new_line");
        let output = format(source, configured.clone()).unwrap();
        assert_eq!(output, "select\n  a\nfrom users;\n");
        assert_eq!(format(&output, configured).unwrap(), output);
        assert_eq!(format(source, options("postgres")).unwrap(), defaults);
        for policy in ["invalid", "new_line\nrules = all"] {
            let mut invalid = options("postgres");
            invalid.settings.single_target_policy = Some(policy);
            assert!(SqlFormatter::new(invalid).is_err());
        }
    }

    #[test]
    fn configurable_layout_preserves_style_and_keeps_cache_entries_separate() {
        let source = "select  custom_function (1,2) from users;";
        let defaults = format(source, options("postgres")).unwrap();
        let mut configured = options("postgres");
        configured.settings.exclude_rules =
            ["LT02", "LT05", "LT06", "LT09"].map(str::to_owned).to_vec();
        configured.settings.types.insert(
            "function_contents".to_owned(),
            SqlLayoutTypeSettings {
                spacing_before: Some("any".into()),
                ..SqlLayoutTypeSettings::default()
            },
        );
        let output = format(source, configured.clone()).unwrap();
        assert!(output.contains("custom_function (1, 2)"), "{output}");
        assert!(!output.contains("select  "));
        assert_ne!(output, defaults);
        assert_eq!(format(&output, configured).unwrap(), output);
        assert_eq!(format(source, options("postgres")).unwrap(), defaults);
    }

    #[test]
    fn invalid_layout_configuration_returns_errors() {
        for rule in ["CP06", "LT00", "LT16", "LT02\nignore = parsing"] {
            let mut configured = options("postgres");
            configured.settings.exclude_rules.push(rule.to_owned());
            assert!(SqlFormatter::new(configured).is_err(), "{rule}");
        }
        for (kind, setting) in [
            ("unknown_type", SqlLayoutTypeSettings::default()),
            (
                "function_contents",
                SqlLayoutTypeSettings {
                    spacing_before: Some("bad".into()),
                    ..SqlLayoutTypeSettings::default()
                },
            ),
            (
                "where_clause",
                SqlLayoutTypeSettings {
                    keyword_line_position: Some("bad".into()),
                    ..SqlLayoutTypeSettings::default()
                },
            ),
        ] {
            let mut configured = options("postgres");
            configured.settings.types.insert(kind.to_owned(), setting);
            assert!(SqlFormatter::new(configured).is_err(), "{kind}");
        }
    }

    #[test]
    fn preserves_sqruff_blank_lines() {
        let source = "select 1;\n\nselect 2;\n";
        let output = format(source, options("postgres")).unwrap();
        assert_eq!(output, source);
        assert_eq!(format(&output, options("postgres")).unwrap(), output);
    }

    #[test]
    fn preserved_indentation_is_relative_and_does_not_change_literal_lines() {
        let source =
            "\n    select\n      $$literal\nzero\n  tail$$ as value\n    from\n      users;\n";
        let mut configured = options("postgres");
        configured.settings.exclude_rules = ["LT02", "LT05", "LT09"].map(str::to_owned).to_vec();
        let output = format(source, configured.clone()).unwrap();
        assert_eq!(output, "select\n  $$literal\nzero\n  tail$$ as value\nfrom\n  users;\n");
        assert_eq!(format(&output, configured).unwrap(), output);
    }

    #[test]
    fn dialects_literals_and_comments() {
        for (dialect, source) in [
            (
                "postgres",
                "SELECT $$line one\nline two$$, E'\\n', \"User\" FROM users -- keep me\nWHERE id=$1;",
            ),
            ("mysql", "select `user`, 'it''s SQL' from `users` where id=1;"),
            ("bigquery", "select a,b from `project.dataset.table` where id=@id;"),
            ("sqlite", "select a,b from users where id=?;"),
            ("ansi", "select a,b from users;"),
            ("snowflake", "select a,b from users;"),
            ("duckdb", "select a,b from users;"),
            ("tsql", "select [a],[b] from [users];"),
        ] {
            let output = format(source, options(dialect))
                .unwrap_or_else(|error| panic!("{dialect}: {error}"));
            assert_eq!(format(&output, options(dialect)).unwrap(), output, "{dialect}");
        }
    }

    #[test]
    fn rejects_invalid_sql_and_inline_configuration() {
        for source in [
            "select * from",
            "select 'unterminated",
            "-- sqruff:rules:all\nselect a,b from users",
            "-- sqlfluff:dialect:mysql\nselect a,b from users",
        ] {
            assert!(format(source, options("postgres")).is_err(), "{source}");
        }
        assert!(format("select 1", options("unknown")).is_err());
    }

    #[test]
    fn parse_errors_locate_the_clause_after_unicode() {
        for separator in [" ", "\n"] {
            let source = format!("select 'é';{separator}select * from");
            let error = format(&source, options("postgres")).unwrap_err();
            assert!(error.message.contains("postgres"));
            assert!(error.message.contains("Unparsable section"));
            let label = &error.labels[0];
            assert_eq!(label.offset() as usize, source.rfind("from").unwrap());
            assert_eq!(&source[label.offset() as usize..][..label.len() as usize], "f");
        }
    }

    #[test]
    fn postgres_overlay_arguments() {
        for source in [
            "select overlay('abcdef' placing 'X' from 2);",
            "select overlay('abcdef' placing 'X' from 2 for 3);",
            "select overlay('abcdef' placing spectrum_offset::text from 19 - length(spectrum_offset::text) + 1 for length(spectrum_offset::text));",
        ] {
            let output = format(source, options("postgres")).unwrap();
            assert!(output.contains("placing"));
            assert_eq!(format(&output, options("postgres")).unwrap(), output);
        }
    }

    #[test]
    fn incomplete_nested_cte_returns_an_error() {
        let source = "with base as materialized (with __oxfmt_sql_expr_0__\nselect a, b, __oxfmt_sql_expr_1__ from prism_values where __oxfmt_sql_expr_2__ order by __oxfmt_sql_expr_3__)\nselect base.a, base.b from base join other using (__oxfmt_sql_expr_4__)";
        assert!(format(source, options("postgres")).is_err());
    }

    #[test]
    fn postgres_quantified_comparisons() {
        let formatter = SqlFormatter::new(options("postgres")).unwrap();
        for quantifier in ["any", "all", "some"] {
            for operand in [
                "array['red'::text, 'cyan'::text]",
                "allowed_values()",
                "select value from allowed",
            ] {
                let source = format!("select x = {quantifier}({operand}) from t;");
                let tables = Tables::default();
                let parsed = formatter.linter.parse_string(&tables, &source, None).unwrap();
                assert!(parsed.violations.is_empty(), "{source}: {:?}", parsed.violations);
                let output = format(&source, options("postgres")).unwrap();
                assert_eq!(format(&output, options("postgres")).unwrap(), output);
            }
        }
    }

    #[test]
    fn postgres_variadic_arrays_keep_keyword_boundaries() {
        for source in [
            "select matches_filter(variadic array['edit'::text]);",
            "select matches_filter(variadic permissions := array['edit'::text]);",
            "create policy allowed on t for insert with check ((select matches_filter(variadic array['edit'::text]) as permitted));",
        ] {
            let output = format(source, options("postgres")).unwrap();
            assert!(output.contains("variadic "));
            assert!(!output.contains("variadicarray"));
            assert_eq!(format(&output, options("postgres")).unwrap(), output);
        }
    }

    #[test]
    fn long_lines_preserve_comment_clauses_and_wrap_other_sql() {
        for (dialect, source, expected) in [
            (
                "postgres",
                "comment on table t is 'a very long comment that must remain on the same line';\nselect first_column,second_column from example_table where first_column=123;",
                "comment on table t is 'a very long comment that must remain on the same line';\nselect\n  first_column,\n  second_column\nfrom example_table\nwhere first_column = 123;\n",
            ),
            (
                "postgres",
                "comment on table t\nis 'a very long comment that must remain on the same line';",
                "comment on table t\nis 'a very long comment that must remain on the same line';\n",
            ),
            (
                "snowflake",
                "create table t (id integer) comment = 'a very long comment that must remain on the same line';",
                "create table t (id integer) comment = 'a very long comment that must remain on the same line';\n",
            ),
            (
                "snowflake",
                "create table a_very_long_table_name_with_lots_of_characters (id integer) comment = 'a very long comment that begins after the maximum line width';",
                "create table a_very_long_table_name_with_lots_of_characters (\n  id integer\n) comment\n= 'a very long comment that begins after the maximum line width';\n",
            ),
        ] {
            let mut options = options(dialect);
            options.core.line_width = 40.try_into().unwrap();
            let output = format(source, options.clone()).unwrap();
            assert_eq!(output, expected, "{dialect}: {source}");
            assert_eq!(format(&output, options).unwrap(), output);
        }
    }

    #[test]
    fn parses_documents_above_the_upstream_default_node_budget() {
        let source = "select 1;\n".repeat(25_000);
        let formatter = SqlFormatter::new(options("postgres")).unwrap();
        let tables = Tables::default();
        let (tokens, errors) =
            formatter.linter.config().get_dialect().lexer().lex(&tables, source.as_str());
        assert_eq!(errors, []);
        assert!(tokens.len() > sqruff_lib_core::parser::DEFAULT_MAX_PARSE_NODES);
        let parsed = formatter.linter.parse_string(&tables, &source, None).unwrap();
        assert!(parsed.violations.is_empty(), "{:?}", parsed.violations);
    }
}
