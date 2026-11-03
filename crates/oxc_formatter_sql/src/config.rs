use hashbrown::HashMap;
use oxc_diagnostics::OxcDiagnostic;
use oxc_formatter_core::IndentStyle;
use serde::Serialize;
use sqruff_lib::core::{
    config::{FluffConfig, Value},
    linter::core::Linter,
};

use crate::{
    SqlCapitalizationSettings, SqlCasePolicy, SqlFormatOptions, SqlLayoutSettings, is_layout_type,
    is_line_position, is_spacing,
};

fn error(message: impl Into<String>) -> OxcDiagnostic {
    OxcDiagnostic::error(message.into())
}

/// Validate capitalization policies and regex exceptions.
///
/// # Errors
/// Returns an error on an unsupported target policy or invalid regex.
pub fn validate_capitalization(settings: &SqlCapitalizationSettings) -> Result<(), String> {
    for (_, section, setting, extended) in settings.rules() {
        let Some(setting) = setting else { continue };
        if !extended
            && matches!(
                setting.policy.unwrap_or_default(),
                SqlCasePolicy::Pascal | SqlCasePolicy::Camel | SqlCasePolicy::Snake
            )
        {
            return Err(format!("{section} supports consistent, upper, lower, or capitalise"));
        }
        if section != "capitalisation.identifiers" && setting.unquoted_identifiers_policy.is_some()
        {
            return Err("unquotedIdentifiersPolicy applies only to identifiers".to_owned());
        }
        for pattern in setting.ignore_words_regex.iter().flatten() {
            regex::Regex::new(pattern)
                .map_err(|e| format!("Invalid SQL capitalization regex: {e}"))?;
        }
    }
    Ok(())
}

/// Validate Sqruff syntax names used in formatting exclusions.
///
/// # Errors
/// Returns an error if a name is unknown.
pub fn validate_syntax_names(names: &[String]) -> Result<(), String> {
    for name in names {
        if name != "aggregate_order_by" && !is_layout_type(name) {
            return Err(format!("Unknown SQL layout syntax type: {name}"));
        }
    }
    Ok(())
}

/// Validate blank-line limits before constructing Sqruff configuration.
///
/// # Errors
/// Returns an error for out-of-range or contradictory limits.
pub fn validate_newlines(settings: &crate::SqlNewlineSettings) -> Result<(), String> {
    for value in [
        settings.minimum_empty_lines_between_statements,
        settings.maximum_empty_lines_between_statements,
        settings.maximum_empty_lines_inside_statements,
        settings.maximum_empty_lines_between_batches,
    ]
    .into_iter()
    .flatten()
    {
        if value > i32::MAX as u32 {
            return Err("SQL blank-line limit exceeds the supported range".to_owned());
        }
    }
    if settings.minimum_empty_lines_between_statements.unwrap_or(0) > 16 {
        return Err("SQL minimum empty lines must not exceed 16".to_owned());
    }
    if settings.minimum_empty_lines_between_statements.unwrap_or(0)
        > settings.maximum_empty_lines_between_statements.unwrap_or(2)
    {
        return Err("SQL minimum empty lines must not exceed the maximum".to_owned());
    }
    Ok(())
}

fn validate(settings: &SqlLayoutSettings) -> Result<(), OxcDiagnostic> {
    if let Some(policy) = settings.single_target_policy
        && !matches!(policy, "same_line" | "new_line")
    {
        return Err(error(format!("Unsupported SQL single-target policy: {policy}")));
    }
    for rule in &settings.exclude_rules {
        let valid = (rule.len() == 4
            && rule.starts_with("LT")
            && rule[2..].parse::<u8>().is_ok_and(|n| (1..=15).contains(&n)))
            || matches!(rule.as_str(), "CP01" | "CP02" | "CP03" | "CP04" | "CP05");
        if !valid {
            return Err(error(format!("Unsupported SQL formatting rule: {rule}")));
        }
    }
    for names in
        [&settings.indentation.skip_indentation_in, &settings.indentation.skip_implicit_indents_in]
            .into_iter()
            .flatten()
    {
        validate_syntax_names(names).map_err(error)?;
    }
    for (kind, setting) in &settings.types {
        if !is_layout_type(kind) {
            return Err(error(format!("Unknown SQL layout syntax type: {kind}")));
        }
        for spacing in [&setting.spacing_before, &setting.spacing_after, &setting.spacing_within]
            .into_iter()
            .flatten()
        {
            if !is_spacing(spacing) {
                return Err(error(format!("Unsupported SQL spacing: {spacing}")));
            }
        }
        if let Some(position) = &setting.line_position
            && !is_line_position(position)
        {
            return Err(error(format!("Unsupported SQL line position: {position}")));
        }
        if let Some(position) = &setting.keyword_line_position
            && position != "none"
            && !is_line_position(position)
        {
            return Err(error(format!("Unsupported SQL keyword line position: {position}")));
        }
        if let Some(names) = &setting.keyword_line_position_exclusions {
            validate_syntax_names(names).map_err(error)?;
        }
        for name in [&setting.align_within, &setting.align_scope].into_iter().flatten() {
            if !is_layout_type(name) {
                return Err(error(format!("Unknown SQL alignment syntax type: {name}")));
            }
        }
        if let Some(space) = &setting.alignment_coordinate_space
            && !matches!(space.as_str(), "source" | "templated")
        {
            return Err(error(format!("Unknown SQL alignment coordinate space: {space}")));
        }
    }
    validate_newlines(&settings.newlines).map_err(error)?;
    validate_capitalization(&settings.capitalization).map_err(error)
}

fn snake_case(key: &str) -> String {
    let mut output = String::with_capacity(key.len());
    for c in key.chars() {
        if c.is_ascii_uppercase() {
            output.push('_');
            output.push(c.to_ascii_lowercase());
        } else {
            output.push(c);
        }
    }
    output
}

fn native_value(value: serde_json::Value) -> Result<Value, OxcDiagnostic> {
    Ok(match value {
        serde_json::Value::Null => Value::None,
        serde_json::Value::Bool(v) => Value::Bool(v),
        serde_json::Value::String(v) => Value::String(v.into()),
        serde_json::Value::Number(v) => Value::Int(
            v.as_i64()
                .and_then(|n| i32::try_from(n).ok())
                .ok_or_else(|| error("SQL formatting number is outside the supported range"))?,
        ),
        serde_json::Value::Array(items) => {
            Value::Array(items.into_iter().map(native_value).collect::<Result<_, _>>()?)
        }
        serde_json::Value::Object(items) => Value::Map(
            items
                .into_iter()
                .map(|(key, value)| Ok((snake_case(&key), native_value(value)?)))
                .collect::<Result<_, OxcDiagnostic>>()?,
        ),
    })
}

fn insert(root: &mut Value, section: &[&str], key: &str, value: Value) {
    let mut current = root;
    for part in section {
        current = current
            .as_map_mut()
            .unwrap()
            .entry((*part).to_owned())
            .or_insert_with(|| Value::Map(HashMap::default()));
    }
    current.as_map_mut().unwrap().insert(key.to_owned(), value);
}

fn apply(
    root: &mut Value,
    section: &[&str],
    settings: &impl Serialize,
) -> Result<(), OxcDiagnostic> {
    let Value::Map(values) =
        native_value(serde_json::to_value(settings).map_err(|e| error(e.to_string()))?)?
    else {
        unreachable!()
    };
    for (key, mut value) in values {
        if value.is_none() {
            continue;
        }
        // These Sqruff settings represent syntax-name sets as comma-separated strings.
        if matches!(
            key.as_str(),
            "skip_indentation_in" | "skip_implicit_indents_in" | "keyword_line_position_exclusions"
        ) {
            let values = value.as_array().unwrap();
            value = Value::String(
                values.iter().map(|v| v.as_string().unwrap()).collect::<Vec<_>>().join(",").into(),
            );
        }
        insert(root, section, &key, value);
    }
    Ok(())
}

pub fn build_linter(options: &SqlFormatOptions) -> Result<Linter, OxcDiagnostic> {
    if !matches!(
        options.dialect,
        "postgres" | "ansi" | "mysql" | "sqlite" | "bigquery" | "snowflake" | "duckdb" | "tsql"
    ) {
        return Err(error("Unsupported SQL dialect"));
    }
    let settings = &options.settings;
    validate(settings)?;
    let mut rules = "layout".to_owned();
    for (code, _, setting, _) in settings.capitalization.rules() {
        if setting.is_some() {
            rules.push(',');
            rules.push_str(code);
        }
    }
    let excludes = if settings.exclude_rules.is_empty() {
        "None".to_owned()
    } else {
        settings.exclude_rules.join(",")
    };
    let indent = if options.core.indent_style == IndentStyle::Tab { "tab" } else { "space" };
    let source = format!(
        "[sqruff]\ndialect = {}\ntemplater = raw\nrules = {rules}\nexclude_rules = {excludes}\nmax_parse_nodes = 1000000\nmax_line_length = {}\n[sqruff:indentation]\nindent_unit = {indent}\ntab_space_size = {}\n[sqruff:rules:layout.long_lines]\nignore_comment_lines = True\nignore_comment_clauses = True\n",
        options.dialect,
        options.core.line_width,
        options.core.indent_width.value().max(1)
    );
    let base = FluffConfig::try_from_source(&source, None).map_err(|e| error(e.to_string()))?;
    let mut root = Value::Map(base.raw);
    apply(&mut root, &["indentation"], &settings.indentation)?;
    apply(&mut root, &["rules", "layout.long_lines"], &settings.long_lines)?;
    apply(&mut root, &["rules", "layout.newlines"], &settings.newlines)?;
    if let Some(policy) = settings.single_target_policy {
        insert(
            &mut root,
            &["rules", "layout.select_targets"],
            "single_target_policy",
            Value::String(policy.into()),
        );
    }
    if let Some(policy) = settings.wildcard_policy {
        insert(
            &mut root,
            &["rules", "layout.select_targets"],
            "wildcard_policy",
            native_value(serde_json::to_value(policy).unwrap())?,
        );
    }
    for (kind, setting) in &settings.types {
        apply(&mut root, &["layout", "type", kind], setting)?;
    }
    for (_, section, setting, extended) in settings.capitalization.rules() {
        let Some(setting) = setting else { continue };
        let path = &["rules", section];
        insert(
            &mut root,
            path,
            if extended { "extended_capitalisation_policy" } else { "capitalisation_policy" },
            native_value(serde_json::to_value(setting.policy.unwrap_or_default()).unwrap())?,
        );
        if let Some(words) = &setting.ignore_words {
            insert(
                &mut root,
                path,
                "ignore_words",
                native_value(serde_json::to_value(words).unwrap())?,
            );
        }
        if let Some(patterns) = &setting.ignore_words_regex {
            insert(
                &mut root,
                path,
                "ignore_words_regex",
                native_value(serde_json::to_value(patterns).unwrap())?,
            );
        }
        if let Some(policy) = setting.unquoted_identifiers_policy {
            insert(
                &mut root,
                path,
                "unquoted_identifiers_policy",
                native_value(serde_json::to_value(policy).unwrap())?,
            );
        }
    }
    let config = FluffConfig::new(root.as_map().unwrap().clone(), None, None);
    Linter::new(config, None, None, true).map_err(error)
}
