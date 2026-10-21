import { describe, expect, it } from "vitest";
import { format, type FormatConfig } from "../../dist/index.js";

async function sqlFormat(source: string, options: FormatConfig = { sql: true }, path = "query.ts") {
  const result = await format(path, source, options);
  expect(result.errors).toEqual([]);
  const second = await format(path, result.code, options);
  expect(second.errors).toEqual([]);
  expect(second.code).toBe(result.code);
  return result.code;
}

describe("Sqruff SQL plugin", () => {
  it("applies Sqruff layout exclusions and spacing to files and templates", async () => {
    const options: FormatConfig = {
      sql: {
        dialect: "postgres",
        excludeRules: ["LT02", "LT05", "LT06", "LT09"],
        layout: { function_contents: { spacingBefore: "any" } },
      },
    };
    const source = "select  custom_function (1,2) from users;";
    const file = await sqlFormat(source, options, "query.sql");
    expect(file).toContain("custom_function (1, 2)");
    expect(file).not.toContain("select  ");
    const embedded = await sqlFormat(`const q = sql\`${source}\`;`, options);
    expect(embedded).toContain("custom_function (1, 2)");

    const nested = await sqlFormat(
      [
        "function query() {",
        "  return sql`",
        "    select",
        "      custom_function (1,2),",
        "      $$literal",
        "zero",
        "  tail$$ as text_value",
        "    from",
        "      users",
        "  `;",
        "}",
      ].join("\n"),
      options,
    );
    expect(nested).toContain("sql`\n    select\n      custom_function (1, 2),");
    expect(nested).toContain("$$literal\nzero\n  tail$$");

    const defaults = await sqlFormat(source, {}, "query.sql");
    expect(defaults).toContain("custom_function(1, 2)");
    expect(await sqlFormat(source, options, "query.sql")).toBe(file);
  });

  it("rejects unsupported Sqruff configuration before formatting", async () => {
    const source = "const q = sql`select 1`;";
    const invalidOptions = [
      { sql: { excludeRules: ["CP01"] } },
      { sql: { layout: { unknown_type: { spacingBefore: "any" } } } },
      { sql: { layout: { function_contents: { spacingBefore: "invalid" } } } },
      { sql: { layout: { where_clause: { keywordLinePosition: "invalid" } } } },
      { sql: { templater: "jinja" } },
    ] as unknown as FormatConfig[];
    for (const options of invalidOptions) {
      const result = await format("query.ts", source, options);
      expect(result.errors).toHaveLength(1);
      expect(result.code).toBe(source);
    }
  });

  it("formats standalone SQL with default options and preserves literals", async () => {
    const source = "select  id,name from users where id=$1;\nselect $$line one\nline two$$;";
    const output = await sqlFormat(source, {}, "query.sql");
    expect(output).toContain("select\n  id,\n  name\nfrom users\nwhere id = $1;");
    expect(output).toContain("$$line one\nline two$$");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("uses standalone SQL dialect, indentation, and file envelope options", async () => {
    const output = await sqlFormat(
      "select `a`,`b` from `users`;",
      {
        sql: { dialect: "mysql" },
        tabWidth: 4,
        endOfLine: "crlf",
        insertFinalNewline: false,
        embeddedLanguageFormatting: "off",
      },
      "query.sql",
    );
    expect(output).toBe("select\r\n    `a`,\r\n    `b`\r\nfrom `users`;");
  });

  it("honors sql: false for standalone files", async () => {
    const source = "select  a,b from users;";
    expect(await sqlFormat(source, { sql: false }, "query.sql")).toBe(source);
  });

  it("reports standalone SQL parse errors and returns the original source", async () => {
    const source = "select * from";
    const result = await format("broken.sql", source);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("postgres");
    expect(result.errors[0].codeframe).toContain("broken.sql");
    expect(result.errors[0].codeframe).toContain("select * from");
    expect(result.code).toBe(source);
  });

  it("formats PostgreSQL OVERLAY with expression arguments", async () => {
    const source =
      "select overlay('abcdef' placing generate_series::text from 35 - length(generate_series::text) + 1 for length(generate_series::text));";
    expect(await sqlFormat(source, {}, "query.sql")).toContain("placing generate_series::text");
  });

  it("preserves an incomplete nested CTE without a parser panic", async () => {
    const sql =
      "with base as materialized (with ${cte} select a, b, ${field} from field_values where ${gate} order by ${order}) select base.a, base.b from base join other using (${fields})";
    expect(await sqlFormat(`const q = sql\`${sql}\`;`)).toContain(sql);
  });

  it("preserves VARIADIC keyword boundaries in PostgreSQL policies", async () => {
    const source =
      "create policy allowed on t for insert with check ((select has_permission(variadic array['edit'::text]) as permitted));";
    expect(await sqlFormat(source, {}, "schema.sql")).toContain("variadic array[");
  });

  it("formats SQL embedded in TypeScript, including expressions and comments", async () => {
    const source = [
      "const query: Query = sql`select  id,name from users where id=${user.id} and active=${ true };`;",
      "const prisma = Prisma.sql`select a,b from users where id=${id}`;",
      "const typed = sql.type(userSchema)`select a,b from users`;",
      "const plain = /* SQL */ `select a,b from users where id=${id}`;",
      "const comment = sql`select a,b from users -- keep this comment\nwhere id=${id};`;",
      "function queryUser(){return sql`select a,b from users where id=${user.id}`;}",
      "const view = <div>{sql`select a,b from users`}</div>;",
    ].join("\n");
    expect(await sqlFormat(source, { sql: true }, "query.tsx")).toMatchSnapshot();
  });

  it.each([{}, { sql: false }, { sql: true, embeddedLanguageFormatting: "off" }] as FormatConfig[])(
    "preserves SQL when the plugin is disabled: %j",
    async (options) => {
      const source = "const q = sql`select  a,b from users`;";
      expect(await sqlFormat(source, options)).toContain("sql`select  a,b from users`");
    },
  );

  it("honors ignore comments and preserves unrelated tags", async () => {
    const ignored = "// oxfmt-ignore\nconst q = sql`select  a,b from users`;";
    expect(await sqlFormat(ignored)).toBe(ignored + "\n");
    expect(await sqlFormat("const q = other`select  a,b from users`;")).toContain(
      "other`select  a,b from users`",
    );
  });

  it.each([
    "select * from",
    "select '__oxfmt_sql_expr_0__'",
    "select \\unicode",
    "-- sqruff:rules:all\nselect  a,b from users",
    "-- sqlfluff:dialect:mysql\nselect  a,b from users",
  ])("preserves unsupported SQL and template content: %s", async (sql) => {
    const output = await sqlFormat(`const q = sql\`${sql}\`;`);
    expect(output).toContain(sql);
  });

  it("supports SQL dialects and inherited indentation and line endings", async () => {
    expect(
      await sqlFormat("function q(){return sql`select \\`a\\`,\\`b\\` from \\`users\\``;}", {
        sql: { dialect: "mysql" },
        tabWidth: 4,
        endOfLine: "crlf",
      }),
    ).toMatchSnapshot();
    expect(
      await sqlFormat("const q = sql`select a,b from users`;", {
        sql: { dialect: "postgres" },
        useTabs: true,
      }),
    ).toMatchSnapshot();
  });

  it("preserves cooked SQL literals and expression evaluation order", async () => {
    const program =
      "const q = sql`select '\\\\n', '\\${literal}', '\\`', $$line one\nline two$$ from users where id=${first()} and name=${second()}`;";
    const output = await sqlFormat(program);
    function evaluate(code: string) {
      const calls: string[] = [];
      const literals: string[] = [];
      // Evaluate trusted fixture code to verify cooked values and expression order.
      // oxlint-disable-next-line typescript/no-implied-eval
      const value = new Function("sql", "first", "second", code + "\nreturn q;")(
        (strings: TemplateStringsArray, ...values: string[]) => {
          literals.push(...strings);
          return strings.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
        },
        () => {
          calls.push("first");
          return "1";
        },
        () => {
          calls.push("second");
          return "Alice";
        },
      );
      return { calls, literals, value };
    }
    const before = evaluate(program);
    const after = evaluate(output);
    expect(after.calls).toEqual(before.calls);
    expect(after.value).toContain("'\\n'");
    expect(after.value).toContain("'${literal}'");
    expect(after.value).toContain("'`'");
    expect(after.value).toContain("$$line one\nline two$$");
    expect(after.value).toContain("id = 1");
    expect(after.value).toContain("name = Alice");
  });

  it("formats SQL fences using the same native plugin", async () => {
    expect(
      await sqlFormat("```sql\nselect a,b from users;\n```\n", { sql: true }, "queries.md"),
    ).toMatchSnapshot();
  });

  it("formats SQL in a virtual TypeScript document", async () => {
    const source =
      '<script lang="ts">const q: Query = sql`select $$line one\nline two$$,a from users where id=${id}`;</script>';
    const output = await sqlFormat(
      source,
      { sql: true, vueIndentScriptAndStyle: true },
      "query.vue",
    );
    expect(output).toContain("$$line one\nline two$$");
    expect(output).toContain("where id = ${id}");
    expect(output).toContain("\n    select\n");
  });
});
