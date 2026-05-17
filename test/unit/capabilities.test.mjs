import test from "node:test";
import assert from "node:assert/strict";

import { commandSupport, listSupportedCommands, supportsCommand } from "../../dist/capabilities.js";

test("commands advertised by initialize capabilities are supported", () => {
  const capabilities = {
    hoverProvider: true,
    definitionProvider: true,
    renameProvider: { prepareProvider: true },
  };

  assert.equal(commandSupport("hover", capabilities), "supported");
  assert.equal(commandSupport("definition", capabilities), "supported");
  assert.equal(commandSupport("rename", capabilities), "supported");
});

test("missing command capability is reported as unsupported", () => {
  const capabilities = { hoverProvider: true };

  assert.equal(commandSupport("format", capabilities), "unsupported");
  assert.equal(supportsCommand("format", capabilities), false);
});

test("diagnostics remain unknown because they are delivered by notification", () => {
  const commands = listSupportedCommands({ hoverProvider: true });

  assert.equal(commands.diagnostics, "unknown");
  assert.equal(supportsCommand("diagnostics", {}), true);
});
