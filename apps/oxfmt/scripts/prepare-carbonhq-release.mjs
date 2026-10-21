// oxlint-disable no-console
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const repo = resolve(import.meta.dirname, "../../..");
const { values } = parseArgs({
  options: {
    artifacts: { type: "string", default: "artifacts" },
    output: { type: "string", default: "target/carbonhq-npm" },
    target: { type: "string", multiple: true },
  },
});
const output = resolve(values.output);
const artifacts = resolve(values.artifacts);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const metadata = readJson(join(repo, "npm/oxfmt/package.json"));
const app = readJson(join(repo, "apps/oxfmt/package.json"));
assert.equal(metadata.name, "@carbonhq/oxfmt");
assert.equal(metadata.napi.packageName, "@carbonhq/oxfmt-binding");
assert.equal(app.napi.packageName, metadata.napi.packageName);
assert.equal(app.version, metadata.version);
assert.equal(
  readFileSync(join(repo, "apps/oxfmt/Cargo.toml"), "utf8").match(/^version = "([^"]+)"/m)?.[1],
  metadata.version,
);
const targets = values.target ?? metadata.napi.targets;
assert(targets.length > 0 && new Set(targets).size === targets.length);
for (const target of targets)
  assert(metadata.napi.targets.includes(target), `Unknown target: ${target}`);
assert(existsSync(artifacts), `Missing artifacts directory: ${artifacts}`);
assert(!existsSync(output), `Output already exists; choose a fresh directory: ${output}`);
mkdirSync(dirname(output), { recursive: true });
mkdirSync(output);

const root = join(output, "package");
const bindings = join(root, "npm");
mkdirSync(root);
for (const file of ["README.md", "configuration_schema.json", "bin"]) {
  cpSync(join(repo, "npm/oxfmt", file), join(root, file), { recursive: true });
}
// Native bindings must resolve from the scoped optional dependencies. Do not let
// an adjacent development binary hide a broken loader or package name.
cpSync(join(repo, "apps/oxfmt/dist"), join(root, "dist"), {
  recursive: true,
  filter: (source) => !source.endsWith(".node"),
});
metadata.napi.targets = targets;
writeJson(join(root, "package.json"), metadata);

function napi(...args) {
  execFileSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "napi", "--cwd", root, ...args],
    {
      cwd: repo,
      stdio: "inherit",
    },
  );
}
napi("create-npm-dirs", "--package-json-path", join(root, "package.json"), "--npm-dir", bindings);
napi(
  "artifacts",
  "--package-json-path",
  join(root, "package.json"),
  "--npm-dir",
  bindings,
  "--output-dir",
  artifacts,
);

function licenses(dir) {
  cpSync(join(repo, "LICENSE"), join(dir, "LICENSE"));
  const thirdParty = join(dir, "THIRD_PARTY_LICENSES");
  mkdirSync(thirdParty, { recursive: true });
  cpSync(join(repo, "vendor/sqruff/LICENSE"), join(thirdParty, "sqruff-APACHE-2.0.txt"));
  cpSync(join(repo, "vendor/sqruff/README.md"), join(thirdParty, "sqruff-provenance.md"));
}
const packages = readdirSync(bindings).map((name) => join(bindings, name));
assert.equal(packages.length, targets.length, "Missing native packages");
metadata.optionalDependencies = {};
for (const dir of packages) {
  const pkg = readJson(join(dir, "package.json"));
  assert(pkg.name.startsWith("@carbonhq/oxfmt-binding-"), pkg.name);
  assert.equal(pkg.version, metadata.version);
  const nativeFiles = pkg.files.filter((file) => file.endsWith(".node"));
  assert.equal(nativeFiles.length, 1, `Expected one native binary in ${pkg.name}`);
  assert(existsSync(join(dir, nativeFiles[0])), `Missing binary: ${pkg.name}/${nativeFiles[0]}`);
  pkg.publishConfig = metadata.publishConfig;
  pkg.files.push("THIRD_PARTY_LICENSES");
  licenses(dir);
  writeJson(join(dir, "package.json"), pkg);
  metadata.optionalDependencies[pkg.name] = pkg.version;
}
licenses(root);
writeJson(join(root, "package.json"), metadata);

const packed = [];
for (const dir of [...packages, root]) {
  const destination = join(output, "tarballs", dir === root ? "root" : "bindings");
  mkdirSync(destination, { recursive: true });
  const [result] = JSON.parse(
    execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["pack", dir, "--json", "--ignore-scripts", "--pack-destination", destination],
      { cwd: repo, encoding: "utf8" },
    ),
  );
  assert(result.files.some((file) => file.path === "LICENSE"));
  assert(result.files.some((file) => file.path.startsWith("THIRD_PARTY_LICENSES/")));
  if (dir === root) {
    assert(!result.files.some((file) => file.path.endsWith(".node")));
    assert(result.files.some((file) => file.path === "dist/index.js"));
    assert(result.files.some((file) => file.path === "bin/oxfmt"));
  } else {
    assert(result.files.some((file) => file.path.endsWith(".node")));
  }
  packed.push({
    name: result.name,
    version: result.version,
    filename: join(destination, result.filename),
  });
}
writeJson(join(output, "manifest.json"), { version: metadata.version, targets, packages: packed });
console.log(`Prepared ${packed.length} tarballs in ${output}. Nothing was published.`);
