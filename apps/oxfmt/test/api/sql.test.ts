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
  it("keeps fitting privilege lists beside GRANT and wraps longer lists stably", async () => {
    const options: FormatConfig = {
      tabWidth: 2,
      sql: {
        printWidth: 120,
        indentation: { implicitIndents: "allow" },
        layout: {
          access_permissions: {
            spacingBefore: "single:inline",
            spacingWithin: "single:inline",
          },
        },
      },
    };
    const source =
      "grant\n  select,\n  insert,\n  delete,\n  update\non table sky_atlasx.catalog_slot to catalog_writers;\n";
    const expected =
      "grant select, insert, delete, update\non table sky_atlasx.catalog_slot to catalog_writers;\n";
    expect(await sqlFormat(source, options, "query.sql")).toBe(expected);
    expect(await sqlFormat("const q = sql`\n" + source + "`;", options)).toContain(
      "grant select, insert, delete, update\n",
    );
    const longList =
      "grant select (first_very_long_column_name, second_very_long_column_name, third_very_long_column_name), update (fourth_very_long_column_name) on table sky_atlasx.catalog_slot to catalog_writers;\n";
    const wrapped = await sqlFormat(longList, options, "query.sql");
    expect(wrapped).toContain("\n  update (fourth_very_long_column_name)\n");
    expect(wrapped.split("\n").every((line) => line.length <= 120)).toBe(true);
  });

  it("lets scalar subquery brackets own comparison indentation", async () => {
    const query =
      "delete from catalog_slot\nwhere\n  id = (\n    select\n      reference_catalog_entry_key\n    from\n      catalog_transient_classification\n    where\n      sector_id = 1\n  )\n";
    const options: FormatConfig = {
      sql: {
        printWidth: 120,
        singleTargetPolicy: "new_line",
        indentation: { implicitIndents: "allow" },
      },
    };
    const operators = [
      "=",
      "!=",
      "<=",
      ">=",
      "<>",
      "is distinct from",
      "is not distinct from",
      "= /* lookup */",
    ];
    await Promise.all(
      operators.map(async (operator) => {
        const source = query.replace("id = (", `id ${operator} (`);
        expect(await sqlFormat(source, options, "query.sql")).toBe(source);
      }),
    );
    const embedded = await sqlFormat(
      "function q(){return sql`\n"
        + query.replace("sector_id = 1", "sector_id = ${input.sectorId}")
        + "`;}",
      options,
    );
    expect(embedded).toContain("      id = (\n        select\n");
    expect(embedded).toContain("          sector_id = ${input.sectorId}\n      )\n");
  });

  it("indents conflict target predicates like ordinary WHERE clauses", async () => {
    const predicates = [
      "  (system_field_id is not null)",
      "  (\n    sector_id is not null\n    and catalog_slot_id is not null\n  )",
    ];
    await Promise.all(
      predicates.map(async (predicate) => {
        const query =
          "insert into t (id) values (1)\non conflict (id)\nwhere\n" + predicate + " do nothing;\n";
        expect(
          await sqlFormat(
            query,
            { sql: { printWidth: 120, indentation: { implicitIndents: "allow" } } },
            "query.sql",
          ),
        ).toBe(query.replace(" do nothing;", "\ndo nothing;"));
      }),
    );
  });

  it("joins already-wrapped table aliases when the pair fits", async () => {
    const query =
      "select\n  instrument.id\nfrom\n  instrument\n  join\n    instrument_value\n      violet_instrument_value\n    on violet_instrument_value.sector_id = instrument.sector_id\n      and violet_instrument_value.instrument_id = instrument.id\n";
    const options: FormatConfig = {
      sql: {
        printWidth: 120,
        singleTargetPolicy: "new_line",
        indentation: { implicitIndents: "allow", indentedJoins: true },
      },
    };
    const output = await sqlFormat(query, options, "query.sql");
    expect(output).toContain("    instrument_value violet_instrument_value\n");
    expect(output).not.toContain("      violet_instrument_value\n");
  });

  it.each(["界界界界界界", "${tableName}"])(
    "counts host indentation and display width when joining aliases: %s",
    async (table) => {
      const source = `function q(){return sql\`\nselect *\nfrom\n  ${table}\n  rel\n\`;}`;
      const output = await sqlFormat(source, { sql: { printWidth: 22 } });
      expect(output).toContain(`      ${table} rel\n`);
      const narrow = await sqlFormat(source, { sql: { printWidth: 21 } });
      expect(narrow).toContain(`      ${table}\n      rel\n`);
    },
  );

  it("preserves comments between relations and aliases", async () => {
    const source =
      "select *\nfrom\n  instrument_value -- preserve this boundary\n  violet_instrument_value;\n";
    const output = await sqlFormat(source, { sql: true }, "query.sql");
    expect(output).toContain(
      "instrument_value -- preserve this boundary\n  violet_instrument_value;",
    );
  });

  it.each(["", "local ", "session "])(
    "indents SET contents including the %s modifier",
    async (modifier) => {
      const source = `set\n  ${modifier}search_path = sky_atlasx,\n  optical;\nset\n  ${modifier}log_statement = 'none';\n`;
      const output = await sqlFormat(
        source,
        {
          sql: { indentation: { implicitIndents: "allow" } },
        },
        "query.sql",
      );
      expect(output).toBe(source);
    },
  );

  it("wraps long JOIN conditions without splitting a short table and alias", async () => {
    const query =
      "select instrument.id from instrument join instrument_value violet_instrument_value on violet_instrument_value.sector_id = instrument.sector_id and violet_instrument_value.instrument_id = instrument.id";
    const output = await sqlFormat(
      query,
      {
        sql: {
          printWidth: 80,
          singleTargetPolicy: "new_line",
          indentation: { implicitIndents: "allow", indentedJoins: true },
        },
      },
      "query.sql",
    );
    expect(output).toContain("instrument_value violet_instrument_value");
    expect(output.split("\n").every((line) => line.length <= 80)).toBe(true);
  });

  it("wraps a long table and alias at the same indentation", async () => {
    const table = "table_" + "a".repeat(55);
    const alias = "alias_" + "b".repeat(55);
    const output = await sqlFormat(
      `select *\nfrom\n  ${table} ${alias};`,
      {
        sql: { printWidth: 120, indentation: { implicitIndents: "allow" } },
      },
      "query.sql",
    );
    expect(output).toContain(`  ${table}\n  ${alias};`);
    expect(output.split("\n").every((line) => line.length <= 120)).toBe(true);
  });

  it("sets SQL width independently for standalone and embedded queries", async () => {
    const query =
      "select sample_blob::jsonb || jsonb_build_object(${calibrationFrame.bandCode}::text, 'amber blue violet 42') from t";
    const source =
      "const value = calculateSomething(firstLongArgument, secondLongArgument, thirdLongArgument);\nfunction q(){return sql`\n"
      + query
      + "\n`; }";
    const options: FormatConfig = {
      printWidth: 80,
      sql: { printWidth: 120, singleTargetPolicy: "new_line" },
    };
    const output = await sqlFormat(source, options);
    expect(output).toContain("calculateSomething(\n");
    expect(output).toContain(
      "      sample_blob::jsonb || jsonb_build_object(${calibrationFrame.bandCode}::text, 'amber blue violet 42')\n",
    );
    const standalone = query.replace("${calibrationFrame.bandCode}", "calibration_frame_key");
    expect(await sqlFormat(standalone, options, "query.sql")).toContain(
      "sample_blob::jsonb || jsonb_build_object(calibration_frame_key::text, 'amber blue violet 42')",
    );
    const inherited = await sqlFormat(standalone, { printWidth: 80, sql: true }, "query.sql");
    expect(inherited.split("\n").every((line) => line.length <= 80)).toBe(true);
  });

  it("wraps function arguments before separating a concatenation", async () => {
    const output = await sqlFormat(
      "function q(){return sql`\nselect sample_blob::jsonb || jsonb_build_object(${calibrationFrame.bandCode}::text, 'amber blue violet 42') from t\n`;}",
      {
        printWidth: 80,
        sql: { printWidth: 80, singleTargetPolicy: "new_line" },
      },
    );
    expect(output).toContain("      sample_blob::jsonb || jsonb_build_object(\n");
    expect(output.split("\n").every((line) => line.length <= 80)).toBe(true);
  });

  it("keeps upsert SET and WHERE at statement level with LT02 enabled", async () => {
    const source =
      "insert into\n  spectrum_family (band, tint)\nvalues\n  ('uv', 'Ultrablue')\non conflict (band) do update\nset\n  tint = excluded.tint\nwhere\n  spectrum_family.tint is distinct from excluded.tint;\n";
    expect(
      await sqlFormat(
        source,
        { sql: { printWidth: 120, indentation: { implicitIndents: "allow" } } },
        "seed.sql",
      ),
    ).toBe(source);
  });

  it("puts the first statistics target on its own line too", async () => {
    const output = await sqlFormat(
      "create statistics sky_atlasx.instrument_reflection_band_catalog_slot on beam_id,\n  catalog_slot_id,\n  hub_id\nfrom\n  sky_atlasx.instrument_reflection_band_catalog_slot;",
      { sql: { printWidth: 120 } },
      "schema.sql",
    );
    expect(output).toContain(" on\n  beam_id,\n  catalog_slot_id,\n  hub_id\nfrom");
  });

  it("wraps foreign keys between clauses before splitting small column lists", async () => {
    const output = await sqlFormat(
      "alter table only sky_atlasx.instrument_value add constraint instrument_value_primary_sector_id_fkey foreign key (hub_id, primary_sector_id, primary_instrument_id) references sky_atlasx.instrument (hub_id, sector_id, id) on delete set null (primary_sector_id, primary_instrument_id) deferrable initially deferred;",
      { sql: { printWidth: 120, indentation: { implicitIndents: "allow" } } },
      "schema.sql",
    );
    expect(output).toContain(
      "foreign key (hub_id, primary_sector_id, primary_instrument_id)\n  references sky_atlasx.instrument(hub_id, sector_id, id)\n  on delete set null",
    );
    expect(output.split("\n").every((line) => line.length <= 120)).toBe(true);
  });

  it("lets policy parentheses own their indentation", async () => {
    const source =
      "create policy star_chart_delete on sky_atlasx.star_chart for delete to catalog_readers using (\n  (\n    select\n      scope_math.matches_filter(variadic array['align-mirrors'::text]) as matches_filter\n  )\n);\n";
    expect(
      await sqlFormat(
        source,
        {
          sql: {
            printWidth: 120,
            singleTargetPolicy: "new_line",
            indentation: { implicitIndents: "allow" },
          },
        },
        "schema.sql",
      ),
    ).toBe(source);
  });

  it("indents a policy USING expression attached to a wrapped header", async () => {
    const source =
      "create policy observation_cycle_select on sky_atlasx.observation_cycle for\n  select\n  to catalog_readers using (\n  (\n    select\n      scope_math.matches_filter(variadic array['count-signals'::text]) as matches_filter\n  )\n);\n";
    const expected =
      "create policy observation_cycle_select on sky_atlasx.observation_cycle for\n  select\n  to catalog_readers using (\n    (\n      select\n        scope_math.matches_filter(variadic array['count-signals'::text]) as matches_filter\n    )\n  );\n";
    expect(
      await sqlFormat(
        source,
        {
          sql: {
            printWidth: 120,
            singleTargetPolicy: "new_line",
            indentation: { implicitIndents: "allow" },
          },
        },
        "schema.sql",
      ),
    ).toBe(expected);
    const narrow = await sqlFormat(
      source,
      {
        sql: {
          printWidth: 82,
          singleTargetPolicy: "new_line",
          indentation: { implicitIndents: "allow" },
        },
      },
      "schema.sql",
    );
    expect(narrow.split("\n").every((line) => line.length <= 82)).toBe(true);
    expect(narrow).toContain("  to catalog_readers using (\n    (\n      select\n");
  });

  it.each(["create", "alter"])("indents wrapped %s policy clauses", async (command) => {
    const source = `${command} policy p on t\nusing\n  (\n    (\n      select\n        matches_filter() as permitted\n    )\n  )\nwith\n  check (\n    (\n      select\n        matches_filter() as permitted\n    )\n  );\n`;
    expect(
      await sqlFormat(
        source,
        { sql: { singleTargetPolicy: "new_line", indentation: { implicitIndents: "allow" } } },
        "schema.sql",
      ),
    ).toBe(source);
  });

  it("keeps inline WITH CHECK parentheses at one indentation level", async () => {
    const source =
      "create policy p on t\nwith check (\n  (\n    select\n      matches_filter() as permitted\n  )\n);\n";
    expect(
      await sqlFormat(
        source,
        { sql: { singleTargetPolicy: "new_line", indentation: { implicitIndents: "allow" } } },
        "schema.sql",
      ),
    ).toBe(source);
  });

  it.each([
    "create function f() returns date language sql\nset\n  \"DateStyle\" to 'ISO, DMY'\nset\n  search_path = sky_atlasx, optical\nas $$select null::date$$;\n",
    "alter function f()\nset\n  \"DateStyle\" to 'ISO, DMY';\n",
  ])("indents function settings without indenting the following clause: %s", async (source) => {
    expect(
      await sqlFormat(source, { sql: { indentation: { implicitIndents: "allow" } } }, "schema.sql"),
    ).toBe(source);
  });

  it.each(["$$", "$body$"])("preserves fitting inline function AS %s after SET", async (quote) => {
    const source = `create function f() returns int language sql\nset\n  search_path = schema_with_a_long_name as ${quote}select 1${quote};\n`;
    const options: FormatConfig = {
      sql: { printWidth: 120, indentation: { implicitIndents: "allow" } },
    };
    expect(await sqlFormat(source, options, "schema.sql")).toBe(source);
    const narrow = await sqlFormat(
      source,
      { sql: { printWidth: 48, indentation: { implicitIndents: "allow" } } },
      "schema.sql",
    );
    expect(narrow).not.toContain(`schema_with_a_long_name as ${quote}`);
    expect(narrow).toContain(`\nas ${quote}select 1${quote};`);
  });

  it("preserves inline AS before a multiline function body", async () => {
    const source =
      "create function f() returns int language plpgsql\nset\n  \"DateStyle\" to 'ISO, DMY' as $$\nbegin\n  return 1;\nend;\n$$;\n";
    expect(
      await sqlFormat(source, { sql: { indentation: { implicitIndents: "allow" } } }, "schema.sql"),
    ).toBe(source);
  });

  it("can avoid an extra THEN-content indent inside a function call", async () => {
    const output = await sqlFormat(
      "const q=sql`\nupdate stars set waveform = case\nwhen ${probe.waveform}::text is not null\nthen combine_signals(\n${probe.waveform}::text,\nflatten(${phaseCode})\n)\nelse waveform\nend\n`;",
      {
        printWidth: 80,
        sql: {
          printWidth: 120,
          indentation: { implicitIndents: "allow", indentedThenContents: false },
        },
      },
    );
    expect(output).toContain(
      "      then combine_signals(\n        ${probe.waveform}::text,\n        flatten(${phaseCode})\n      )",
    );
  });

  it("retains inline WHEN/THEN with one function-argument indent", async () => {
    const output = await sqlFormat(
      "const q=sql`\nupdate stars set waveform = case\nwhen ${probe.waveform}::text is not null then combine_signals(\n${probe.waveform}::text,\nflatten(${phaseCode})\n)\nelse waveform\nend\n`;",
      {
        printWidth: 80,
        sql: {
          printWidth: 120,
          indentation: {
            implicitIndents: "allow",
            indentedThen: false,
            indentedThenContents: false,
          },
        },
      },
    );
    expect(output).toContain(
      "    when ${probe.waveform}::text is not null then combine_signals(\n      ${probe.waveform}::text,\n      flatten(${phaseCode})\n    )",
    );
  });

  it("keeps a FILTER predicate together when it fits the SQL width", async () => {
    const predicate =
      "trim(coalesce(sector_instruments.sample_blob ->> sector_field.band_code, '')) != ''";
    const output = await sqlFormat(
      `function f(){return sql\`\nselect count(*) filter (\nwhere\n${predicate}\n) as sample_count from t\n\`;}`,
      {
        printWidth: 80,
        sql: {
          printWidth: 120,
          singleTargetPolicy: "new_line",
          indentation: { implicitIndents: "allow" },
        },
      },
    );
    expect(output).toContain(predicate);
    expect(output.split("\n").every((line) => line.length <= 120)).toBe(true);
  });

  it("counts Unicode display width when wrapping SQL arguments", async () => {
    const output = await sqlFormat(
      `const q=sql\`\nselect my_function('${"界".repeat(28)}', 'value', 'other') from t\n\`;`,
      { printWidth: 80, sql: { printWidth: 80 } },
    );
    expect(output).toContain("my_function(\n");
    expect(output).toContain("界".repeat(28));
  });

  it("measures interpolation IR without consuming the host Tailwind class scope", async () => {
    const output = await sqlFormat(
      'const q = sql`select ${<div className="p-4 flex" />}`;',
      { sql: true, sortTailwindcss: {} },
      "query.tsx",
    );
    expect(output).toContain('className="flex p-4"');
  });

  it.each([
    (query: string) => `return sql\`\n${query}\n\`;`,
    (query: string) => `await client.query(sql\`\n${query}\n\`);`,
    (query: string) => `const obj = { query: sql\`\n${query}\n\` };`,
    (query: string) => `const q = condition ? sql\`\n${query}\n\` : null;`,
    (query: string) => `const q = () => sql\`\n${query}\n\`;`,
  ])("counts host indentation and long interpolations at wrap boundaries: %#", async (wrap) => {
    await Promise.all(
      [39, 40, 41, 42].map(async (length) => {
        const query = `select left_column_name || jsonb_build_object(\${calibrationFrame.bandCode}::text, '${"x".repeat(length)}') from t`;
        const output = await sqlFormat(`async function f(){if(true){${wrap(query)}}}`, {
          printWidth: 80,
          sql: {
            printWidth: 120,
            singleTargetPolicy: "new_line",
            indentation: { implicitIndents: "allow" },
          },
        });
        expect(output.split("\n").every((line) => line.length <= 120)).toBe(true);
      }),
    );
  });

  it("indents comparison continuations separately from AND conditions", async () => {
    const output = await sqlFormat(
      "function q(){return sql`\nselect * from x join y on instrument_linked_number.primary_station_id = instrument_linked_timestamp.primary_station_id and instrument_linked_number.primary_instrument_id = instrument_linked_timestamp.primary_instrument_id\n`;}",
      {
        printWidth: 80,
        sql: {
          printWidth: 80,
          singleTargetPolicy: "new_line",
          indentation: { implicitIndents: "allow", indentedJoins: true },
        },
      },
    );
    expect(output).toContain(
      "on instrument_linked_number.primary_station_id\n            = instrument_linked_timestamp.primary_station_id",
    );
    expect(output).toContain(
      "and instrument_linked_number.primary_instrument_id\n            = instrument_linked_timestamp.primary_instrument_id",
    );
  });

  it("counts short interpolations by their printed length", async () => {
    const output = await sqlFormat(
      "const q=sql`\nselect my_function(${x}, 'abcdefghijklmnop', 'abcdefghijklmnop') from t\n`;",
      { printWidth: 80, sql: { printWidth: 80 } },
    );
    expect(output).toContain("my_function(${x}, 'abcdefghijklmnop', 'abcdefghijklmnop')");
  });

  it.each([
    { tabWidth: 2, useTabs: false },
    { tabWidth: 4, useTabs: false },
    { tabWidth: 4, useTabs: true },
  ])("inherits SQL indentation in multiline interpolations: %j", async (indentation) => {
    const unit = indentation.useTabs ? "\t" : " ".repeat(indentation.tabWidth);
    const line = (level: number, text: string) => unit.repeat(level) + text;
    const source = [
      "function query(filter) {",
      line(1, "return sql`"),
      line(2, "select"),
      line(3, "id"),
      line(2, "from"),
      line(3, "${readSkySource({"),
      line(4, "filter, // Preserve the filter."),
      line(4, "// Include the sector relation."),
      line(4, "joinSector: true,"),
      line(3, "})} ${readSkyFilter({"),
      line(4, "filter,"),
      line(4, "joinPrism: true,"),
      line(3, "})}"),
      line(1, "`;"),
      "}",
      "",
    ].join("\n");
    expect(
      await sqlFormat(source, {
        ...indentation,
        printWidth: 80,
        trailingComma: "es5",
        sql: { singleTargetPolicy: "new_line" },
      }),
    ).toBe(source);
  });

  it("inherits nested SQL indentation for interpolated calls and nested templates", async () => {
    const source = [
      "const q = sql`",
      "  select",
      "    id",
      "  from (",
      "    select",
      "      id",
      "    from",
      "      users",
      "    where",
      "      id in (${getIds({",
      "        values: ids.map(id => sql`${id}`),",
      "        includeDeleted: false,",
      "      })})",
      "  ) as nested",
      "`;",
      "",
    ].join("\n");
    expect(
      await sqlFormat(source, {
        printWidth: 80,
        trailingComma: "es5",
        arrowParens: "avoid",
        sql: { singleTargetPolicy: "new_line", indentation: { implicitIndents: "allow" } },
      }),
    ).toBe(source);
  });

  it("inherits alignment spaces when SQL indentation is preserved", async () => {
    const source = [
      "const q = sql`",
      "  select",
      "     ${getValue({",
      "       first: 1,",
      "       second: 2,",
      "     })}",
      "  from users",
      "`;",
      "",
    ].join("\n");
    expect(await sqlFormat(source, { sql: { excludeRules: ["LT02", "LT05", "LT09"] } })).toBe(
      source,
    );
  });

  it.each(["sql", "Prisma.sql", "sql.type(schema)", "/* SQL */ "])(
    "keeps short one-line SQL templates inline: %s",
    async (tag) => {
      const source = `await client.query(${tag}\`create  schema if not exists sky_temp;\`);`;
      expect(await sqlFormat(source, { sql: true, printWidth: 80 })).toBe(
        source.replace("create  schema", "create schema") + "\n",
      );
    },
  );

  it("measures the surrounding JavaScript when deciding whether SQL fits", async () => {
    const source = "await client.query(sql`create schema if not exists sky_temp;`);";
    expect(await sqlFormat(source, { sql: true, printWidth: source.length })).toBe(source + "\n");
    const expanded = "await client.query(sql`\n  create schema if not exists sky_temp;\n`);\n";
    expect(await sqlFormat(source, { sql: true, printWidth: source.length - 1 })).toBe(expanded);
    expect(
      await sqlFormat(`async function run() { ${source} }`, {
        sql: true,
        printWidth: source.length,
      }),
    ).toBe(
      "async function run() {\n  await client.query(sql`\n    create schema if not exists sky_temp;\n  `);\n}\n",
    );
  });

  it("measures substituted expressions instead of SQL placeholder names", async () => {
    const source = "await client.query(sql`drop table if exists sky_temp.${table};`);";
    expect(await sqlFormat(source, { sql: true, printWidth: 80 })).toBe(source + "\n");
    const long = source.replace("${table}", "${temporaryTableNameForSpectralReadouts}");
    expect(await sqlFormat(long, { sql: true, printWidth: 80 })).toBe(
      long.replace("sql`", "sql`\n  ").replace("`);", "\n`);") + "\n",
    );
  });

  it.each([
    "create schema if not exists sky_temp;\n",
    "\ncreate schema if not exists sky_temp;",
    "\ncreate schema if not exists sky_temp;\n",
  ])("keeps originally multiline SQL expanded: %j", async (query) => {
    expect(await sqlFormat(`await client.query(sql\`${query}\`);`)).toBe(
      "await client.query(sql`\n  create schema if not exists sky_temp;\n`);\n",
    );
  });

  it("keeps SQL expanded when an interpolation was originally multiline", async () => {
    expect(await sqlFormat("const q = sql`drop table if exists sky_temp.${\n table\n};`;")).toBe(
      "const q = sql`\n  drop table if exists sky_temp.${table};\n`;\n",
    );
  });

  it.each(["\\n", "\\x27 OR true --", "\\u0027 OR true --"])(
    "preserves raw SQL escape spelling: %s",
    async (escape) => {
      const source = "const q = sql`select 1 where 'sample' = '" + escape + "'`;";
      expect(await sqlFormat(source)).toBe(source + "\n");
    },
  );

  it("preserves literal LF bytes when layout uses CRLF", async () => {
    const query = "select 'red\nblue', $$one\ntwo$$;";
    const output = await sqlFormat(query, { endOfLine: "crlf" }, "query.sql");
    expect(output).toContain("'red\nblue'");
    expect(output).toContain("$$one\ntwo$$");
    expect(output.endsWith(";\r\n")).toBe(true);
  });

  it("honors zero tab width without dividing by zero", async () => {
    expect(await sqlFormat("select 1;", { tabWidth: 0 }, "query.sql")).toBe("select 1;\n");
  });

  it("puts single SELECT targets on a new line in files and templates", async () => {
    const source = "select a from users;";
    const options: FormatConfig = { sql: { singleTargetPolicy: "new_line" } };
    expect(await sqlFormat(source, options, "query.sql")).toBe("select\n  a\nfrom users;\n");
    const embedded = await sqlFormat(`const q = sql\`${source}\`;`, options);
    expect(embedded).toMatch(/select\n\s+a\n\s+from users/);
    expect(await sqlFormat(source, { sql: { singleTargetPolicy: "same_line" } }, "query.sql")).toBe(
      "select a from users;\n",
    );
  });

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

  it("indents PostgreSQL continuations with LT02 enabled", async () => {
    const source = "insert into\nsky_atlasx.t (id, name)\nvalues\n(1, 'One'),\n(2, 'Two');";
    const options: FormatConfig = { sql: { indentation: { implicitIndents: "allow" } } };
    expect(await sqlFormat(source, options, "seed.sql")).toBe(
      "insert into\n  sky_atlasx.t (id, name)\nvalues\n  (1, 'One'),\n  (2, 'Two');\n",
    );
    expect(await sqlFormat(source, { ...options, tabWidth: 4 }, "seed.sql")).toContain(
      "values\n    (1, 'One'),\n    (2, 'Two');",
    );
  });

  it("supports required implicit indents without conflicting whitespace fixes", async () => {
    const source = "select count(*) filter (\nwhere\ntrim(name) != ''\n) from t;";
    const output = await sqlFormat(
      source,
      { sql: { indentation: { implicitIndents: "require" } } },
      "query.sql",
    );
    expect(output).toContain("where trim(name) != ''");
  });

  it("configures joins, CTE bodies, long lines and statement blank lines", async () => {
    const options: FormatConfig = {
      sql: {
        indentation: {
          indentedJoins: true,
          indentedCtes: true,
          indentedUsingOn: false,
          indentedOnContents: false,
        },
        longLines: { ignoreCommentLines: true, ignoreCommentClauses: true },
        newlines: { minimumEmptyLinesBetweenStatements: 1, maximumEmptyLinesBetweenStatements: 1 },
      },
    };
    const output = await sqlFormat(
      "select t.id from t\njoin u on t.id=u.id;\nselect 2;",
      options,
      "query.sql",
    );
    expect(output).toContain("\n  join u");
    expect(output).toContain(";\n\nselect 2;");
    const cte = await sqlFormat(
      "with x as (\nselect id from t\n)\nselect id from x;",
      options,
      "query.sql",
    );
    expect(cte).toContain("as (\n    select");
  });

  it("aligns aliases using structured and compact layout settings", async () => {
    const source = "select a as first_value, longer_name as second_value from t;";
    const structured: FormatConfig = {
      sql: {
        layout: {
          alias_expression: {
            spacingBefore: "align",
            alignWithin: "select_clause",
            alignScope: "bracketed",
            alignmentCoordinateSpace: "source",
          },
        },
      },
    };
    const compact: FormatConfig = {
      sql: {
        layout: {
          alias_expression: {
            spacingBefore: "align:alias_expression:select_clause:bracketed:source",
          },
        },
      },
    };
    const output = await sqlFormat(source, structured, "query.sql");
    const aliases = output.split("\n").filter((line) => line.includes(" as "));
    expect(aliases).toHaveLength(2);
    expect(aliases[0].indexOf(" as ")).toBe(aliases[1].indexOf(" as "));
    expect(await sqlFormat(source, compact, "query.sql")).toBe(output);
  });

  it("enables capitalization separately and preserves quoted SQL content", async () => {
    const source = `select coalesce(MixedName, 'Keep Me') as "KeepAlias", true, null, 1::int from MixedTable;`;
    const output = await sqlFormat(
      source,
      {
        sql: {
          capitalization: {
            keywords: { policy: "upper" },
            identifiers: { policy: "lower" },
            functions: { policy: "upper" },
            literals: { policy: "upper" },
            types: { policy: "upper" },
          },
        },
      },
      "query.sql",
    );
    expect(output).toContain("COALESCE(mixedname, 'Keep Me') AS \"KeepAlias\"");
    expect(output).toContain("TRUE");
    expect(output).toContain("NULL");
    expect(output).toContain("1::INT");
    expect(output).toContain("FROM mixedtable;");
    expect(await sqlFormat(source, {}, "query.sql")).toContain("MixedName");
  });

  it("honors capitalization exceptions and identifier scope", async () => {
    const output = await sqlFormat(
      "select coalesce(Foo, 1::int), null as MyAlias from MyTable;",
      {
        sql: {
          capitalization: {
            keywords: { policy: "upper", ignoreWords: ["select"] },
            identifiers: { policy: "upper", unquotedIdentifiersPolicy: "aliases" },
            functions: { policy: "upper", ignoreWordsRegex: ["^coal"] },
            types: { policy: "upper", ignoreWords: ["int"] },
          },
        },
      },
      "query.sql",
    );
    expect(output).toContain("select");
    expect(output).toContain("coalesce(Foo, 1::int)");
    expect(output).toContain("AS MYALIAS");
    expect(output).toContain("FROM MyTable");
  });

  it("rejects capitalization styles that rename identifiers", async () => {
    const source = "select MixedName from t;";
    const result = await format("query.sql", source, {
      sql: { capitalization: { identifiers: { policy: "snake" } } },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("protected tokens");
    expect(result.code).toBe(source);
  });

  it("substitutes SQL expressions after identifier capitalization", async () => {
    const output = await sqlFormat("const q = sql`select ${user.id} from ${table};`;", {
      sql: { capitalization: { keywords: { policy: "upper" }, identifiers: { policy: "upper" } } },
    });
    expect(output).toContain("SELECT ${user.id} FROM ${table};");
    expect(output).not.toContain("__OXFMT_SQL_EXPR");
  });

  it("rejects unsupported Sqruff configuration before formatting", async () => {
    const source = "const q = sql`select 1`;";
    const invalidOptions = [
      { sql: { singleTargetPolicy: "invalid" } },
      { sql: { excludeRules: ["CP06"] } },
      { sql: { layout: { unknown_type: { spacingBefore: "any" } } } },
      { sql: { layout: { function_contents: { spacingBefore: "invalid" } } } },
      { sql: { layout: { where_clause: { keywordLinePosition: "invalid" } } } },
      { sql: { templater: "jinja" } },
      { sql: { indentation: { implicitIndents: "invalid" } } },
      { sql: { indentation: { skipIndentationIn: ["invalid_type"] } } },
      {
        sql: {
          newlines: {
            minimumEmptyLinesBetweenStatements: 3,
            maximumEmptyLinesBetweenStatements: 1,
          },
        },
      },
      { sql: { newlines: { maximumEmptyLinesInsideStatements: 2147483648 } } },
      {
        sql: {
          newlines: {
            minimumEmptyLinesBetweenStatements: 17,
            maximumEmptyLinesBetweenStatements: 17,
          },
        },
      },
      { sql: { capitalization: { keywords: { policy: "snake" } } } },
      { sql: { capitalization: { functions: { ignoreWordsRegex: ["["] } } } },
      { sql: { layout: { alias_expression: { spacingBefore: "align:invalid_type" } } } },
    ] as unknown as FormatConfig[];
    await Promise.all(
      invalidOptions.map(async (options) => {
        const result = await format("query.ts", source, options);
        expect(result.errors).toHaveLength(1);
        expect(result.code).toBe(source);
      }),
    );
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
      "select overlay('abcdef' placing spectrum_offset::text from 19 - length(spectrum_offset::text) + 1 for length(spectrum_offset::text));";
    expect(await sqlFormat(source, {}, "query.sql")).toContain("placing spectrum_offset::text");
  });

  it("preserves an incomplete nested CTE without a parser panic", async () => {
    const sql =
      "with base as materialized (with ${cte} select a, b, ${field} from prism_values where ${gate} order by ${order}) select base.a, base.b from base join other using (${fields})";
    expect(await sqlFormat(`const q = sql\`${sql}\`;`)).toContain(sql);
  });

  it("preserves VARIADIC keyword boundaries in PostgreSQL policies", async () => {
    const source =
      "create policy allowed on t for insert with check ((select matches_filter(variadic array['edit'::text]) as permitted));";
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
