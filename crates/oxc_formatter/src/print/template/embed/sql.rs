use oxc_allocator::ArenaStringBuilder;
use oxc_ast::ast::*;
use oxc_formatter_core::{FormatElement, dispatch_fragment_ir, format_element::TextWidth};

use crate::{
    ast_nodes::AstNode,
    formatter::prelude::*,
    print::template::{
        FormatTemplateExpression, FormatTemplateExpressionOptions, TemplateExpression,
    },
    write,
};

// Valid SQL identifiers, left untouched by the layout-only plugin. A source
// collision is rejected before dispatch, and every marker must survive in order.
const PREFIX: &str = "__oxfmt_sql_expr_";
const SUFFIX: &str = "__";

pub(super) fn format_sql_doc<'a>(
    quasi: &AstNode<'a, TemplateLiteral<'a>>,
    f: &mut JsFormatter<'_, 'a>,
) -> bool {
    let allocator = f.allocator();
    let mut joined = ArenaStringBuilder::new_in(allocator);
    for (index, element) in quasi.quasis.iter().enumerate() {
        let Some(text) = element.value.cooked.as_ref().and_then(|value| value.as_str()) else {
            return false;
        };
        if text.contains(PREFIX) {
            return false;
        }
        if index > 0 {
            let _ = std::fmt::Write::write_fmt(
                &mut joined,
                format_args!("{PREFIX}{}{SUFFIX}", index - 1),
            );
        }
        joined.push_str(text);
    }
    let Some(ir) = dispatch_fragment_ir(f, "sql", joined.into_str(), None) else {
        return false;
    };
    let expressions: Vec<_> = quasi.expressions().iter().collect();
    let mut next_index = 0;
    for element in &ir {
        if let FormatElement::Text { text, .. } = element {
            let parts = super::split_on_placeholders(text, PREFIX, SUFFIX);
            for index in parts.iter().skip(1).step_by(2) {
                if index.parse::<usize>() != Ok(next_index) {
                    return false;
                }
                next_index += 1;
            }
        }
    }
    if next_index != expressions.len() {
        return false;
    }
    let ir = super::escape_template_chars_in_ir(ir, f);
    if ir.is_empty() {
        write!(f, ["``"]);
        return true;
    }
    let content = format_once(move |f: &mut JsFormatter<'_, 'a>| {
        for element in ir {
            match element {
                FormatElement::Text { text, .. } if text.contains(PREFIX) => {
                    for (index, part) in
                        super::split_on_placeholders(text, PREFIX, SUFFIX).into_iter().enumerate()
                    {
                        if index % 2 == 0 {
                            if !part.is_empty() {
                                f.write_element(FormatElement::Text {
                                    text: part,
                                    width: TextWidth::from_text(part, f.options().indent_width),
                                });
                            }
                        } else {
                            // Validated above before any host output is written.
                            let expression = TemplateExpression::Expression(
                                expressions[part.parse::<usize>().unwrap()],
                            );
                            FormatTemplateExpression::new(
                                &expression,
                                FormatTemplateExpressionOptions::default(),
                            )
                            .fmt(f);
                        }
                    }
                }
                element => f.write_element(element),
            }
        }
    });
    write!(f, ["`", block_indent(&content), "`"]);
    true
}
