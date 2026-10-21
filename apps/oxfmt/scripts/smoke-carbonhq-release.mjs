// oxlint-disable no-console
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [directory, bindingName] = process.argv.slice(2);
assert(
  directory && bindingName,
  "Usage: smoke-carbonhq-release.mjs <output> <native-package-name>",
);
const release = JSON.parse(readFileSync(join(resolve(directory), "manifest.json"), "utf8"));
const main = release.packages.find((pkg) => pkg.name === "@carbonhq/oxfmt");
const binding = release.packages.find((pkg) => pkg.name === bindingName);
assert(main && binding, "Main package or requested native package is missing");
const consumer = mkdtempSync(join(tmpdir(), "carbonhq-oxfmt-smoke-"));
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        [main.name]: `file:${main.filename}`,
        [binding.name]: `file:${binding.filename}`,
      },
    },
    null,
    2,
  ),
);
execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: consumer, stdio: "inherit" },
);
const installed = join(consumer, "node_modules/@carbonhq/oxfmt");
const version = execFileSync(process.execPath, [join(installed, "bin/oxfmt"), "--version"], {
  encoding: "utf8",
}).trim();
assert(version.includes(release.version), version);
const html = join(consumer, "page.html");
writeFileSync(html, "<div>\n<span>hello</span>\n<p>world</p>\n</div>");
execFileSync(process.execPath, [join(installed, "bin/oxfmt"), "--write", html], {
  stdio: "inherit",
});
execFileSync(process.execPath, [join(installed, "bin/oxfmt"), "--check", html], {
  stdio: "inherit",
});
assert(readFileSync(html, "utf8").includes("  <span>hello</span>"));
const { format } = await import(pathToFileURL(join(installed, "dist/index.js")).href);
for (const [file, source, options] of [
  ["query.sql", "select  a,b from users where id=$1;", {}],
  ["query.ts", "const q=sql`select a,b from users where id=${id}`;", { sql: true }],
  ["query.sql", "select `a`,`b` from `users`;", { sql: { dialect: "mysql" } }],
]) {
  const result = await format(file, source, options);
  assert.deepEqual(result.errors, []);
  assert.notEqual(result.code, source);
  const second = await format(file, result.code, options);
  assert.deepEqual(second.errors, []);
  assert.equal(second.code, result.code);
}
console.log(
  `Installed ${main.name}@${release.version} with ${bindingName}; CLI, HTML worker, SQL, and embedded SQL pass.`,
);
