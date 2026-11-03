use oxc_allocator::{ArenaStringBuilder, ArenaVec};
use oxc_ast::ast::*;
use oxc_formatter_core::{Document, FormatElement, dispatch_fragment_ir};

use crate::{
    ast_nodes::AstNode,
    embed_context::SqlInJsTemplate,
    format_args,
    formatter::prelude::*,
    print::template::{
        FormatTemplateExpression, FormatTemplateExpressionOptions, TemplateExpression,
    },
    write,
};

// Valid SQL identifiers. Capitalization may change their case, so matching is
// case-insensitive. Source collisions are rejected and markers must survive in order.
const PREFIX: &str = "__oxfmt_sql_expr_";
const SUFFIX: &str = "__";

pub(super) fn format_sql_doc<'a>(
    quasi: &AstNode<'_, 'a, TemplateLiteral<'a>>,
    f: &mut JsFormatter<'_, 'a>,
) -> bool {
    let allocator = f.allocator();
    let mut joined = ArenaStringBuilder::new_in(allocator);
    for (index, element) in quasi.quasis.iter().enumerate() {
        let Some(text) = element.value.cooked.as_ref().and_then(|value| value.as_str()) else {
            return false;
        };
        // A tag may consume strings.raw. Only format escapes we can reproduce exactly.
        if super::escape_template_chars(text, allocator).unwrap_or(text)
            != element.value.raw.as_str()
            || super::find_ignore_ascii_case(text, PREFIX).is_some()
        {
            return false;
        }
        if index > 0 {
            let _ = std::fmt::Write::write_fmt(
                &mut joined,
                std::format_args!("{PREFIX}{}{SUFFIX}", index - 1),
            );
        }
        joined.push_str(text);
    }
    let expressions: Vec<_> = quasi.expressions().iter().collect();
    let snapshot = f.context().comments().snapshot();
    let mut expression_ir = Vec::with_capacity(expressions.len());
    let mut context = SqlInJsTemplate {
        base_indent: f.expanded_indent_width(&f.options().as_print_options())
            + usize::from(f.options().indent_width.value()),
        tab_width: usize::from(f.options().indent_width.value()),
        replacements: Vec::with_capacity(expressions.len()),
    };
    for (index, expression) in expressions.iter().enumerate() {
        let expression = TemplateExpression::Expression(*expression);
        let ir = f.format_to_vec(|f| {
            FormatTemplateExpression::new(&expression, FormatTemplateExpressionOptions::default())
                .fmt(f);
        });
        // Measure the same formatted expression that will be inserted below,
        // including ${}, comments, parentheses, and internal line breaks.
        let measured = Document::new(
            ArenaVec::from_iter_in(ir.iter().cloned(), &allocator),
            f.session().unsorted_tailwind_classes(),
        )
        .print(0, f.options().as_print_options());
        let Ok(printed) = measured else {
            f.context_mut().comments_mut().restore(snapshot);
            return false;
        };
        context.replacements.push((format!("{PREFIX}{index}{SUFFIX}"), printed.into_code()));
        expression_ir.push(ir);
    }
    let Some(ir) = dispatch_fragment_ir(f, "sql", joined.into_str(), Some(&context)) else {
        f.context_mut().comments_mut().restore(snapshot);
        return false;
    };
    let mut next_index = 0;
    for element in &ir {
        if let FormatElement::Text { text, .. } = element {
            let parts = super::split_on_placeholders(text, PREFIX, SUFFIX);
            for index in parts.iter().skip(1).step_by(2) {
                if index.parse::<usize>() != Ok(next_index) {
                    f.context_mut().comments_mut().restore(snapshot);
                    return false;
                }
                next_index += 1;
            }
        }
    }
    if next_index != expressions.len() {
        f.context_mut().comments_mut().restore(snapshot);
        return false;
    }
    if ir.is_empty() {
        write!(f, ["``"]);
        return true;
    }
    let is_multiline = f.source_text().contains_newline(quasi.span);
    let content = format_once(move |f: &mut JsFormatter<'_, 'a>| {
        for element in ir {
            match element {
                FormatElement::Text { text, .. }
                    if super::find_ignore_ascii_case(text.as_str(), PREFIX).is_some() =>
                {
                    for (index, part) in super::split_on_placeholders(text.as_str(), PREFIX, SUFFIX)
                        .into_iter()
                        .enumerate()
                    {
                        if index % 2 == 0 {
                            if !part.is_empty() {
                                f.write_element(FormatElement::literal_text(
                                    super::escape_template_chars(part, allocator).unwrap_or(part),
                                    f.options().indent_width,
                                ));
                            }
                        } else {
                            // Validated above before any host output is written.
                            for element in &expression_ir[part.parse::<usize>().unwrap()] {
                                f.write_element(element.clone());
                            }
                        }
                    }
                }
                FormatElement::Text { text, .. }
                    if let Some(escaped) =
                        super::escape_template_chars(text.as_str(), allocator) =>
                {
                    f.write_element(FormatElement::literal_text(escaped, f.options().indent_width));
                }
                element => f.write_element(element),
            }
        }
    });
    if is_multiline {
        write!(f, ["`", block_indent(&content), "`"]);
    } else {
        write!(f, [group(&format_args!("`", soft_block_indent(&content), "`"))]);
    }
    true
}
