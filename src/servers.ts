/**
 * Language server configurations.
 * Each entry defines how to launch a specific LSP server.
 */

export interface ServerConfig {
  name: string;
  command: string;
  args: string[];
  extensions: string[];
  languageIds: Record<string, string>;
  initializationOptions?: Record<string, unknown>;
}

export const SERVER_REGISTRY: Record<string, ServerConfig> = {
  pyright: {
    name: "Pyright",
    command: "pyright-langserver",
    args: ["--stdio"],
    extensions: ["py", "pyi"],
    languageIds: { py: "python", pyi: "python" },
  },
  pylsp: {
    name: "Python LSP Server (pylsp)",
    command: "pylsp",
    args: [],
    extensions: ["py", "pyi"],
    languageIds: { py: "python", pyi: "python" },
  },
  typescript: {
    name: "TypeScript Language Server",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
    languageIds: {
      ts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      jsx: "javascriptreact",
      mjs: "javascript",
      cjs: "javascript",
    },
  },
};

/** Default server for each language group */
const LANG_DEFAULTS: Record<string, string> = {
  python: "pyright",
  javascript: "typescript",
  typescript: "typescript",
};

/** Resolve the best server config for a file extension. */
export function resolveServer(ext: string, preferredServer?: string): ServerConfig | null {
  if (preferredServer) {
    const cfg = SERVER_REGISTRY[preferredServer];
    if (cfg && cfg.extensions.includes(ext)) return cfg;
    if (cfg) return cfg; // even if extension doesn't match, trust the user
    return null;
  }

  const candidates = Object.entries(SERVER_REGISTRY).filter(([, cfg]) =>
    cfg.extensions.includes(ext)
  );
  if (candidates.length === 0) return null;

  for (const [key, cfg] of candidates) {
    const langId = cfg.languageIds[ext];
    if (langId && LANG_DEFAULTS[langId] === key) return cfg;
  }
  return candidates[0][1];
}

/** Find the server name key in the registry. */
export function findServerName(config: ServerConfig): string {
  for (const [name, cfg] of Object.entries(SERVER_REGISTRY)) {
    if (cfg === config) return name;
  }
  return "unknown";
}

export function getLanguageId(config: ServerConfig, ext: string): string {
  return config.languageIds[ext] ?? ext;
}
