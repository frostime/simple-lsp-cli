import test from "node:test";
import assert from "node:assert/strict";

import { formatResultText } from "../../dist/format.js";

const file = "C:\\repo\\src\\sample.ts";

test("format text output includes text edit arrays", () => {
  const output = formatResultText({
    command: "format",
    file,
    result: [
      {
        range: { start: { line: 2, character: 1 }, end: { line: 2, character: 3 } },
        newText: "    ",
      },
    ],
  });

  assert.match(output, /^1 edits\n/);
  assert.match(output, /sample\.ts L2:1-3 -> "    "/);
});

test("edit text output preserves full replacement text", () => {
  const longText = "x".repeat(120);
  const output = formatResultText({
    command: "rename",
    file,
    result: {
      edits: [
        {
          file,
          range: { start: { line: 1, character: 10 }, end: { line: 1, character: 15 } },
          newText: longText,
        },
      ],
    },
  });

  assert.match(output, /^1 rename edits\n/);
  assert.ok(output.includes(JSON.stringify(longText)));
  assert.ok(!output.includes("…"));
});

test("code action text output includes concrete edits", () => {
  const output = formatResultText({
    command: "codeActions",
    file,
    result: [
      {
        title: "Fix assignment",
        kind: "quickfix",
        isPreferred: true,
        edit: {
          edits: [
            {
              file,
              range: { start: { line: 7, character: 7 }, end: { line: 7, character: 13 } },
              newText: "result",
            },
          ],
        },
      },
    ],
  });

  assert.match(output, /^1 code actions\n/);
  assert.match(output, /1\. Fix assignment \[quickfix, preferred, 1 edits\]/);
  assert.match(output, /sample\.ts L7:7-13 -> "result"/);
});
