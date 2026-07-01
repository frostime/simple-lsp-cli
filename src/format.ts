import * as path from "node:path";

interface Position {
  line: number;
  character: number;
}

interface Range {
  start: Position;
  end: Position;
}

interface LocationLike {
  file?: string;
  range?: Range;
}

interface SymbolLike {
  name?: string;
  kind?: string;
  range?: Range;
  children?: SymbolLike[];
}

interface DiagnosticLike {
  severity?: string;
  message?: string;
  range?: Range;
  source?: string;
  code?: string | number;
}

interface CompletionItemLike {
  label?: string;
  kind?: string;
  detail?: string;
  documentation?: string;
}

interface CompletionListLike {
  isIncomplete?: boolean;
  items?: CompletionItemLike[];
}

interface SignatureParameterLike {
  label?: string;
  documentation?: string;
}

interface SignatureLike {
  label?: string;
  documentation?: string;
  parameters?: SignatureParameterLike[];
}

interface SignatureHelpLike {
  activeSignature?: number;
  activeParameter?: number;
  signatures?: SignatureLike[];
}

interface EditLike {
  file?: string;
  range?: Range;
  newText?: string;
}

interface WorkspaceEditLike {
  edits?: EditLike[];
}

interface CodeActionLike {
  title?: string;
  kind?: string;
  isPreferred?: boolean;
  edit?: WorkspaceEditLike;
}

function displayPath(file?: string): string {
  if (!file) return "(unknown file)";
  const rel = path.relative(process.cwd(), file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) && rel === file) return file;
  return rel;
}

function formatPosition(pos?: Position): string {
  return pos ? `L${pos.line}:${pos.character}` : "(unknown position)";
}

function formatRange(range?: Range): string {
  if (!range) return "(unknown range)";
  const start = formatPosition(range.start);
  if (range.start.line === range.end.line) return `${start}-${range.end.character}`;
  return `${start}-${range.end.line}:${range.end.character}`;
}

function formatLocationLine(loc: LocationLike): string {
  return `${displayPath(loc.file)} ${formatRange(loc.range)}`;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function shortText(text: string | undefined, max = 120): string {
  if (!text) return "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function countSymbols(symbols: SymbolLike[]): number {
  let total = 0;
  for (const sym of symbols) {
    total += 1;
    total += countSymbols(sym.children ?? []);
  }
  return total;
}

function formatSymbolsTree(symbols: SymbolLike[], depth = 0): string[] {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);
  for (const sym of symbols) {
    const kind = (sym.kind ?? "symbol").toLowerCase();
    const name = sym.name ?? "(anonymous)";
    const where = formatRange(sym.range);
    lines.push(`${indent}${kind} ${name} ${where}`);
    lines.push(...formatSymbolsTree(sym.children ?? [], depth + 1));
  }
  return lines;
}

function formatLocations(label: string, value: unknown): string {
  const locations = asArray(value as LocationLike | LocationLike[] | null);
  if (locations.length === 0) return `0 ${label}`;
  if (locations.length === 1) return formatLocationLine(locations[0]);
  return [`${locations.length} ${label}:`, ...locations.map(formatLocationLine)].join("\n");
}

function formatHover(file: string, position: Position | undefined, value: unknown): string {
  const hover = value as { contents?: string; range?: Range } | null;
  if (!hover?.contents) {
    return `${displayPath(file)} ${formatPosition(position)}\n0 hover results`;
  }
  const where = hover.range?.start ?? position;
  return `${displayPath(file)} ${formatPosition(where)}\n${hover.contents.trim()}`;
}

function formatSymbols(file: string, value: unknown): string {
  const symbols = asArray(value as SymbolLike | SymbolLike[] | null);
  if (symbols.length === 0) return `${displayPath(file)} - 0 symbols`;
  const total = countSymbols(symbols);
  return [`${displayPath(file)} - ${total} symbols`, ...formatSymbolsTree(symbols)].join("\n");
}

function formatDiagnostics(file: string, value: unknown): string {
  const diagnostics = asArray(value as DiagnosticLike | DiagnosticLike[] | null);
  if (diagnostics.length === 0) return `${displayPath(file)} - 0 diagnostics`;
  return [
    `${displayPath(file)} - ${diagnostics.length} diagnostics`,
    ...diagnostics.map((diag) => {
      const severity = diag.severity ?? "unknown";
      const source = diag.source ? ` [${diag.source}${diag.code != null ? ` ${diag.code}` : ""}]` : diag.code != null ? ` [${diag.code}]` : "";
      return `${severity} ${formatRange(diag.range)}: ${diag.message ?? ""}${source}`;
    }),
  ].join("\n");
}

function formatCompletion(value: unknown): string {
  if (Array.isArray(value)) {
    return formatCompletion({ isIncomplete: false, items: value });
  }
  const completion = (value ?? {}) as CompletionListLike;
  const items = completion.items ?? [];
  if (items.length === 0) {
    return completion.isIncomplete ? "0 completion items (incomplete)" : "0 completion items";
  }
  return [
    `${items.length} completion items${completion.isIncomplete ? " (incomplete)" : ""}`,
    ...items.map((item) => {
      const parts = [`${item.label ?? "(unnamed)"}`];
      if (item.kind) parts.push(`(${item.kind.toLowerCase()})`);
      if (item.detail) parts.push(`: ${shortText(item.detail, 80)}`);
      else if (item.documentation) parts.push(`: ${shortText(item.documentation, 80)}`);
      return parts.join("");
    }),
  ].join("\n");
}

function formatSignatureHelp(value: unknown): string {
  const help = (value ?? {}) as SignatureHelpLike;
  const signatures = help.signatures ?? [];
  if (signatures.length === 0) return "0 signatures";
  const activeSignature = signatures[help.activeSignature ?? 0] ?? signatures[0];
  const lines = [activeSignature.label ?? "(unnamed signature)"];
  if (activeSignature.documentation) lines.push(shortText(activeSignature.documentation, 160));
  const activeParam = activeSignature.parameters?.[help.activeParameter ?? 0];
  if (activeParam) {
    lines.push(`active parameter: ${typeof activeParam.label === "string" ? activeParam.label : JSON.stringify(activeParam.label)}`);
    if (activeParam.documentation) lines.push(shortText(activeParam.documentation, 120));
  }
  if (signatures.length > 1) lines.push(`${signatures.length} signatures available`);
  return lines.join("\n");
}

function editLine(edit: EditLike, defaultFile?: string): string {
  return `${displayPath(edit.file ?? defaultFile)} ${formatRange(edit.range)} -> ${JSON.stringify(edit.newText ?? "")}`;
}

function editsFrom(value: unknown): EditLike[] {
  if (Array.isArray(value)) return value as EditLike[];
  const editContainer = (value ?? {}) as WorkspaceEditLike;
  return editContainer.edits ?? [];
}

function formatEdits(label: string, value: unknown, defaultFile?: string): string {
  const edits = editsFrom(value);
  if (edits.length === 0) return `0 ${label}`;
  return [
    `${edits.length} ${label}`,
    ...edits.map((edit) => editLine(edit, defaultFile)),
  ].join("\n");
}

function formatCodeActions(value: unknown): string {
  const actions = asArray(value as CodeActionLike | CodeActionLike[] | null);
  if (actions.length === 0) return "0 code actions";
  return [
    `${actions.length} code actions`,
    ...actions.flatMap((action, index) => {
      const extras: string[] = [];
      if (action.kind) extras.push(action.kind);
      if (action.isPreferred) extras.push("preferred");
      const edits = editsFrom(action.edit);
      if (edits.length) extras.push(`${edits.length} edits`);
      const lines = [`${index + 1}. ${action.title ?? "(untitled action)"}${extras.length ? ` [${extras.join(", ")}]` : ""}`];
      lines.push(...edits.map((edit) => `   ${editLine(edit)}`));
      return lines;
    }),
  ].join("\n");
}

export function formatResultText(args: {
  command: string;
  file: string;
  position?: Position;
  result: unknown;
}): string {
  const { command, file, position, result } = args;

  switch (command) {
    case "hover":
      return formatHover(file, position, result);
    case "definition":
      return formatLocations("definitions", result);
    case "typeDefinition":
      return formatLocations("type definitions", result);
    case "references":
      return formatLocations("references", result);
    case "completion":
      return formatCompletion(result);
    case "signatureHelp":
      return formatSignatureHelp(result);
    case "symbols":
      return formatSymbols(file, result);
    case "diagnostics":
      return formatDiagnostics(file, result);
    case "format":
      return formatEdits("edits", result, file);
    case "rename":
      return formatEdits("rename edits", result, file);
    case "codeActions":
      return formatCodeActions(result);
    default:
      return typeof result === "string" ? result : JSON.stringify(result);
  }
}

