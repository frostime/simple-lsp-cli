import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pathToUri, uriToPath, normalizeUri } from "../../dist/lsp-client.js";
import { simplify } from "../../dist/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureFile = path.resolve(__dirname, "../../temp/test-fixtures/space name.ts");

function normalizePathCase(filePath) {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

test("pathToUri and uriToPath round-trip local paths", () => {
  const uri = pathToUri(fixtureFile);
  assert.match(uri, /^file:\/\//);
  assert.equal(normalizePathCase(uriToPath(uri)), normalizePathCase(fixtureFile));
});

test("uriToPath decodes percent-encoded Windows-style file URIs", () => {
  const decoded = uriToPath("file:///h%3A/Work/space%20name.ts");
  // fileURLToPath keeps the drive segment: "h:/..." on Windows, "/h:/..." on POSIX
  const drivePrefix = process.platform === "win32" ? /^h:/i : /^\/h:/;
  assert.match(decoded, drivePrefix);
  assert.ok(decoded.endsWith(path.join("Work", "space name.ts")));
});

test("normalizeUri lowercases the drive letter and decodes %3A", () => {
  assert.equal(
    normalizeUri("file:///H%3A/Work/Test.ts"),
    "file:///h:/Work/Test.ts",
  );
});

test("simplify converts Location URIs to local paths", () => {
  const simplified = simplify({
    uri: "file:///h%3A/Work/demo.ts",
    range: {
      start: { line: 0, character: 1 },
      end: { line: 0, character: 5 },
    },
  });

  const expectedFile = process.platform === "win32"
    ? path.join("h:", "Work", "demo.ts")
    : "/h:/Work/demo.ts";
  assert.equal(
    normalizePathCase(simplified.file),
    normalizePathCase(expectedFile),
  );
  assert.deepEqual(simplified.range, {
    start: { line: 1, character: 2 },
    end: { line: 1, character: 6 },
  });
});

test("simplify converts TextEdit arrays to 1-based ranges", () => {
  const simplified = simplify([
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 2 },
      },
      newText: "  ",
    },
  ]);

  assert.deepEqual(simplified, [
    {
      range: {
        start: { line: 1, character: 1 },
        end: { line: 1, character: 3 },
      },
      newText: "  ",
    },
  ]);
});
