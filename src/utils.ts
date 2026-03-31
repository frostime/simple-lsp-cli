/**
 * Output formatting and LSP result simplification.
 * Converts raw LSP responses into clean, agent-friendly JSON.
 *
 * Key transforms:
 *   - file:// URIs → absolute paths
 *   - 0-based positions → 1-based
 *   - Enum numbers → human-readable strings
 *   - Strip noisy fields
 */

import { uriToPath } from "./lsp-client.js";

// ─── Top-level output ─────────────────────────────────────────

export function jsonOutput(data: {
  success: boolean;
  command: string;
  file?: string;
  position?: { line: number; character: number };
  result?: unknown;
  error?: string;
}): string {
  return JSON.stringify(data, null, 1);
}

// ─── LSP result simplifier ───────────────────────────────────

export function simplify(val: unknown): unknown {
  if (val == null) return null;

  if (isTextEditArray(val)) {
    return val.map((edit) => ({
      range: range1(edit.range),
      newText: edit.newText,
    }));
  }

  if (Array.isArray(val)) return val.map(simplify);
  if (typeof val !== "object") return val;

  const o = val as Record<string, unknown>;

  // Location { uri, range }
  if ("uri" in o && "range" in o && Object.keys(o).length <= 3) {
    return { file: uriToPath(o.uri as string), range: range1(o.range as R) };
  }

  // LocationLink { targetUri, targetRange, ... }
  if ("targetUri" in o) {
    return {
      file: uriToPath(o.targetUri as string),
      range: o.targetRange ? range1(o.targetRange as R) : undefined,
      originRange: o.originSelectionRange ? range1(o.originSelectionRange as R) : undefined,
    };
  }

  // Hover { contents, range? }
  if ("contents" in o && !("name" in o)) {
    return {
      contents: flattenContents(o.contents),
      ...(o.range ? { range: range1(o.range as R) } : {}),
    };
  }

  // DocumentSymbol / SymbolInformation
  if ("name" in o && ("kind" in o || "selectionRange" in o)) {
    const sym: Record<string, unknown> = {
      name: o.name,
      kind: SYMBOL_KIND[o.kind as number] ?? String(o.kind),
    };
    if (o.detail) sym.detail = o.detail;
    if (o.range) sym.range = range1(o.range as R);
    if (o.selectionRange) sym.selectionRange = range1(o.selectionRange as R);
    if (o.children) sym.children = (o.children as unknown[]).map(simplify);
    if (o.location) sym.location = simplify(o.location);
    return sym;
  }

  // Diagnostic { severity, message, range }
  if ("severity" in o && "message" in o && "range" in o) {
    return {
      severity: SEVERITY[o.severity as number] ?? String(o.severity),
      message: o.message,
      range: range1(o.range as R),
      ...(o.source ? { source: o.source } : {}),
      ...(o.code != null ? { code: o.code } : {}),
    };
  }

  // CompletionList { items, isIncomplete }
  if ("items" in o && "isIncomplete" in o) {
    return {
      isIncomplete: o.isIncomplete,
      items: (o.items as Record<string, unknown>[]).map((item) => ({
        label: item.label,
        kind: COMPLETION_KIND[item.kind as number] ?? String(item.kind),
        ...(item.detail ? { detail: item.detail } : {}),
        ...(item.documentation ? { documentation: flattenContents(item.documentation) } : {}),
      })),
    };
  }

  // CompletionItem (standalone)
  if ("label" in o && "kind" in o && !("name" in o)) {
    return {
      label: o.label,
      kind: COMPLETION_KIND[o.kind as number] ?? String(o.kind),
      ...(o.detail ? { detail: o.detail } : {}),
      ...(o.documentation ? { documentation: flattenContents(o.documentation) } : {}),
    };
  }

  // SignatureHelp
  if ("signatures" in o && Array.isArray(o.signatures)) {
    return {
      activeSignature: o.activeSignature ?? 0,
      activeParameter: o.activeParameter ?? 0,
      signatures: (o.signatures as Record<string, unknown>[]).map((sig) => ({
        label: sig.label,
        documentation: sig.documentation ? flattenContents(sig.documentation) : undefined,
        parameters: (sig.parameters as Record<string, unknown>[] | undefined)?.map((param) => ({
          label: param.label,
          documentation: param.documentation ? flattenContents(param.documentation) : undefined,
        })),
      })),
    };
  }

  // WorkspaceEdit { changes, documentChanges }
  if ("changes" in o || "documentChanges" in o) {
    const edits: Record<string, unknown>[] = [];

    if (o.changes && typeof o.changes === "object") {
      for (const [uri, changes] of Object.entries(o.changes as Record<string, unknown[]>)) {
        for (const change of changes) {
          const edit = change as { range: R; newText: string };
          edits.push({ file: uriToPath(uri), range: range1(edit.range), newText: edit.newText });
        }
      }
    }

    if (Array.isArray(o.documentChanges)) {
      for (const dc of o.documentChanges as Record<string, unknown>[]) {
        if (!dc.textDocument || !dc.edits) continue;
        const uri = (dc.textDocument as { uri: string }).uri;
        for (const edit of dc.edits as { range: R; newText: string }[]) {
          edits.push({ file: uriToPath(uri), range: range1(edit.range), newText: edit.newText });
        }
      }
    }

    return { edits };
  }

  // CodeAction
  if ("title" in o && ("kind" in o || "diagnostics" in o || "edit" in o || "command" in o)) {
    return {
      title: o.title,
      kind: o.kind ?? undefined,
      isPreferred: o.isPreferred ?? undefined,
      ...(o.edit ? { edit: simplify(o.edit) } : {}),
    };
  }

  // Generic fallback — recurse
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(o)) {
    out[key] = simplify(value);
  }
  return out;
}

// ─── Internal helpers ─────────────────────────────────────────

type R = { start: { line: number; character: number }; end: { line: number; character: number } };

function isTextEditArray(val: unknown): val is { range: R; newText: string }[] {
  return Array.isArray(val)
    && val.length > 0
    && typeof val[0] === "object"
    && val[0] !== null
    && "newText" in (val[0] as Record<string, unknown>)
    && "range" in (val[0] as Record<string, unknown>);
}

/** Convert 0-based range to 1-based. */
function range1(r: R) {
  return {
    start: { line: r.start.line + 1, character: r.start.character + 1 },
    end: { line: r.end.line + 1, character: r.end.character + 1 },
  };
}

function flattenContents(c: unknown): string {
  if (typeof c === "string") return c;
  if (c && typeof c === "object") {
    if ("value" in (c as Record<string, unknown>)) return (c as { value: string }).value;
  }
  if (Array.isArray(c)) return c.map(flattenContents).join("\n\n");
  return String(c);
}

const SEVERITY: Record<number, string> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

const SYMBOL_KIND: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
  6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
  11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
  15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
  20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
  25: "Operator", 26: "TypeParameter",
};

const COMPLETION_KIND: Record<number, string> = {
  1: "Text", 2: "Method", 3: "Function", 4: "Constructor", 5: "Field",
  6: "Variable", 7: "Class", 8: "Interface", 9: "Module", 10: "Property",
  11: "Unit", 12: "Value", 13: "Enum", 14: "Keyword", 15: "Snippet",
  16: "Color", 17: "File", 18: "Reference", 19: "Folder", 20: "EnumMember",
  21: "Constant", 22: "Struct", 23: "Event", 24: "Operator", 25: "TypeParameter",
};
