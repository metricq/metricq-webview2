import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The frontend must work behind a reverse proxy that serves it under an
// arbitrary prefix (e.g. /webview/). Every URL the browser resolves must
// therefore be relative to the current page, never absolute to the host root.

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(webDir, rel), "utf8");
}

function sourceFiles(sub, exts) {
  return readdirSync(join(webDir, sub))
    .filter((name) => exts.some((ext) => name.endsWith(ext)))
    .map((name) => join(sub, name));
}

test("index.html references assets and links relatively", () => {
  const html = read("index.html");
  const absolute = [...html.matchAll(/\b(?:href|src|action)="(\/[^"]*)"/g)]
    .map((m) => m[1])
    .filter((value) => !value.startsWith("//"));
  assert.deepEqual(absolute, []);
});

test("stylesheets do not use root-absolute url()", () => {
  for (const file of ["style.css", ...sourceFiles("css", [".css"])]) {
    const css = read(file);
    const absolute = [...css.matchAll(/url\(\s*["']?(\/[^"')]*)/g)]
      .map((m) => m[1])
      .filter((value) => !value.startsWith("//"));
    assert.deepEqual(absolute, [], file);
  }
});

test("frontend modules call the API with relative paths", () => {
  for (const file of sourceFiles("js", [".js", ".mjs"])) {
    const src = read(file);
    const absolute = src.match(/["'`]\/api\//g) || [];
    assert.equal(absolute.length, 0, `${file} uses a root-absolute /api/ path`);
  }
});

test("relative API paths resolve under a proxy prefix", () => {
  assert.equal(
    new URL("api/query", "https://example.org/webview/").toString(),
    "https://example.org/webview/api/query",
  );
  assert.equal(
    new URL("api/query", "http://localhost:8080/").toString(),
    "http://localhost:8080/api/query",
  );
});
