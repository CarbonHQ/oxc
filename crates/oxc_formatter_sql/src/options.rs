//! Formatting-only Sqruff options shared by the backend and Oxfmt configuration.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Sqruff indentation choices. Width and indent characters inherit `tabWidth` and `useTabs`.
#[derive(Clone, Debug, Default, Eq, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct SqlIndentationSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indented_joins: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indented_joins_on: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indented_ctes: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indented_using_on: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indented_on_contents: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indented_then: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indented_then_contents: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implicit_indents: Option<SqlImplicitIndents>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hanging_indents: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_blocks_indent: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_indentation_in: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_implicit_indents_in: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trailing_comments: Option<SqlTrailingComments>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_comment_lines: Option<bool>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SqlImplicitIndents {
    Forbid,
    Allow,
    Require,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SqlTrailingComments {
    Before,
    After,
}

/// Exceptions to LT05's line-width enforcement. Width inherits `printWidth`.
#[derive(Clone, Debug, Default, Eq, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct SqlLongLineSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_comment_lines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_comment_clauses: Option<bool>,
}

/// Whether a wildcard counts as one SELECT target or multiple targets for LT09.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SqlWildcardPolicy {
    Single,
    Multiple,
}

/// Blank-line limits for LT15.
#[derive(Clone, Debug, Default, Eq, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct SqlNewlineSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum_empty_lines_between_statements: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum_empty_lines_inside_statements: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum_empty_lines_between_batches: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_empty_lines_between_statements: Option<u32>,
}

/// Optional case normalization. Only configured targets enable their CP rule.
/// Quoted identifiers, string literals, and comments are always preserved.
#[derive(Clone, Debug, Default, Eq, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct SqlCapitalizationSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<SqlCaseSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identifiers: Option<SqlCaseSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub functions: Option<SqlCaseSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub literals: Option<SqlCaseSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub types: Option<SqlCaseSettings>,
}

/// Capitalization policy and exceptions for one target. Regexes are Rust regexes.
/// `unquotedIdentifiersPolicy` applies only to the identifiers target.
#[derive(Clone, Debug, Default, Eq, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct SqlCaseSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy: Option<SqlCasePolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_words: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_words_regex: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unquoted_identifiers_policy: Option<SqlIdentifierPolicy>,
}

/// Case styles supported by Sqruff. Keywords and literals use the first four.
/// Styles that would rename a token rather than just change its case are rejected.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SqlCasePolicy {
    #[default]
    Consistent,
    Upper,
    Lower,
    Capitalise,
    Pascal,
    Camel,
    Snake,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SqlIdentifierPolicy {
    All,
    None,
    Aliases,
    ColumnAliases,
    TableAliases,
}

impl SqlCapitalizationSettings {
    pub(crate) fn rules(
        &self,
    ) -> [(&'static str, &'static str, Option<&SqlCaseSettings>, bool); 5] {
        [
            ("CP01", "capitalisation.keywords", self.keywords.as_ref(), false),
            ("CP02", "capitalisation.identifiers", self.identifiers.as_ref(), true),
            ("CP03", "capitalisation.functions", self.functions.as_ref(), true),
            ("CP04", "capitalisation.literals", self.literals.as_ref(), false),
            ("CP05", "capitalisation.types", self.types.as_ref(), true),
        ]
    }

    pub(crate) fn is_enabled(&self) -> bool {
        self.rules().iter().any(|(_, _, settings, _)| settings.is_some())
    }
}

/// Validate spacing before Sqruff parses its compact alignment syntax.
pub fn is_spacing(value: &str) -> bool {
    if matches!(value, "single" | "touch" | "any" | "single:inline" | "touch:inline" | "align") {
        return true;
    }
    let mut parts = value.split(':');
    if parts.next() != Some("align") {
        return false;
    }
    let parts: Vec<_> = parts.collect();
    (1..=4).contains(&parts.len())
        && parts[..parts.len().min(3)].iter().all(|part| super::is_layout_type(part))
        && (parts.len() < 4 || matches!(parts[3], "source" | "templated"))
}

/// Validate line-position modifiers without allowing arbitrary configuration text.
pub fn is_line_position(value: &str) -> bool {
    let mut parts = value.split(':');
    matches!(parts.next(), Some("leading" | "trailing" | "alone"))
        && parts.all(|part| matches!(part, "strict" | "attached" | "align-following"))
}
