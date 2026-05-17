export type CliCommand =
  | "hover"
  | "definition"
  | "typeDefinition"
  | "references"
  | "completion"
  | "signatureHelp"
  | "symbols"
  | "format"
  | "diagnostics"
  | "rename"
  | "codeActions";

export type CommandSupport = "supported" | "unsupported" | "unknown";

export const CLI_COMMANDS: CliCommand[] = [
  "hover",
  "definition",
  "typeDefinition",
  "references",
  "completion",
  "signatureHelp",
  "symbols",
  "format",
  "diagnostics",
  "rename",
  "codeActions",
];

export const COMMAND_CAPABILITIES: Record<CliCommand, string | null> = {
  hover: "hoverProvider",
  definition: "definitionProvider",
  typeDefinition: "typeDefinitionProvider",
  references: "referencesProvider",
  completion: "completionProvider",
  signatureHelp: "signatureHelpProvider",
  symbols: "documentSymbolProvider",
  format: "documentFormattingProvider",
  diagnostics: null,
  rename: "renameProvider",
  codeActions: "codeActionProvider",
};

export function commandCapability(command: CliCommand): string | null {
  return COMMAND_CAPABILITIES[command];
}

export function commandSupport(
  command: CliCommand,
  capabilities: Record<string, unknown> | null | undefined
): CommandSupport {
  if (command === "diagnostics") return "unknown";
  if (!capabilities) return "unknown";

  const capability = COMMAND_CAPABILITIES[command];
  if (!capability) return "unknown";

  return capabilities[capability] ? "supported" : "unsupported";
}

export function supportsCommand(
  command: CliCommand,
  capabilities: Record<string, unknown> | null | undefined
): boolean {
  return commandSupport(command, capabilities) !== "unsupported";
}

export function listSupportedCommands(
  capabilities: Record<string, unknown> | null | undefined
): Record<CliCommand, CommandSupport> {
  const out = {} as Record<CliCommand, CommandSupport>;
  for (const command of CLI_COMMANDS) {
    out[command] = commandSupport(command, capabilities);
  }
  return out;
}

export function isCliCommand(command: string): command is CliCommand {
  return (CLI_COMMANDS as string[]).includes(command);
}
