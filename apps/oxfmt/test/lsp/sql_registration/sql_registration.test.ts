import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createLspConnection } from "../utils";

it("registers SQL synchronization and formatting on the existing client connection", async () => {
  await using client = createLspConnection();
  const rootUri = pathToFileURL(join(import.meta.dirname, "../format/fixtures/format")).href;
  const registrationPromise = client.getDynamicRegistration();
  await client.initialize([{ uri: rootUri, name: "test" }], {
    textDocument: {
      synchronization: { dynamicRegistration: true },
      formatting: { dynamicRegistration: true },
    },
  });
  const registrations = await registrationPromise;
  expect(registrations.map(({ method }) => method)).toEqual([
    "textDocument/didOpen",
    "textDocument/didChange",
    "textDocument/didClose",
    "textDocument/formatting",
  ]);
  for (const { method, registerOptions } of registrations) {
    expect(registerOptions).toEqual({
      documentSelector: [
        { language: "sql", scheme: "file" },
        { language: "sql", scheme: "untitled" },
      ],
      ...(method === "textDocument/didChange" ? { syncKind: 1 } : {}),
    });
  }

  // File content intentionally differs from the fixture on disk. Both this and
  // untitled content must come from the newly registered synchronization channel.
  for (const uri of [`${rootUri}/test.sql`, "untitled:Untitled-1"]) {
    const text = "select unsaved_column from unsaved_table";
    // oxlint-disable-next-line no-await-in-loop
    await client.didOpen(uri, "sql", text);
    // oxlint-disable-next-line no-await-in-loop
    const edits = await client.format(uri);
    expect(edits?.length).toBeGreaterThan(0);
    expect(TextDocument.applyEdits(TextDocument.create(uri, "sql", 1, text), edits!)).toBe(
      `${text}\n`,
    );

    const changed = "select changed_column from changed_table";
    // oxlint-disable-next-line no-await-in-loop
    await client.didChange(uri, changed);
    // oxlint-disable-next-line no-await-in-loop
    const changedEdits = await client.format(uri);
    expect(
      TextDocument.applyEdits(TextDocument.create(uri, "sql", 2, changed), changedEdits!),
    ).toBe(`${changed}\n`);
  }
});
