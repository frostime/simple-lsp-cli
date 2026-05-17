/**
 * Language server configurations.
 * Each entry defines how to launch a specific LSP server.
 */

export interface ServerConfig {
  name: string;
  command: string;
  args: string[];
  transport?: "stdio";
  extensions: string[];
  languageIds: Record<string, string>;
  rootMarkers?: string[];
  initializationOptions?: Record<string, unknown>;
  env?: Record<string, string>;
}

export const SERVER_REGISTRY: Record<string, ServerConfig> = {
  pyright: {
    name: "Pyright",
    command: "pyright-langserver",
    args: ["--stdio"],
    transport: "stdio",
    extensions: ["py", "pyi"],
    languageIds: { py: "python", pyi: "python" },
    rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg"],
  },
  pylsp: {
    name: "Python LSP Server (pylsp)",
    command: "pylsp",
    args: [],
    transport: "stdio",
    extensions: ["py", "pyi"],
    languageIds: { py: "python", pyi: "python" },
    rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg"],
  },
  typescript: {
    name: "TypeScript Language Server",
    command: "typescript-language-server",
    args: ["--stdio"],
    transport: "stdio",
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
    languageIds: {
      ts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      jsx: "javascriptreact",
      mjs: "javascript",
      cjs: "javascript",
    },
    rootMarkers: ["package.json", "tsconfig.json"],
  },
};

export const BUILTIN_DEFAULT_SERVERS: Record<string, string> = {
  py: "pyright",
  pyi: "pyright",
  ts: "typescript",
  tsx: "typescript",
  js: "typescript",
  jsx: "typescript",
  mjs: "typescript",
  cjs: "typescript",
};

export const BUILTIN_ROOT_MARKERS = [
  "package.json", "tsconfig.json", "pyproject.toml",
  "setup.py", "setup.cfg", ".git", "Cargo.toml", "go.mod",
  "pom.xml", "build.gradle",
];

/** Resolve the best server config for a file extension. */
export function resolveServer(
  ext: string,
  preferredServer?: string,
  registry: Record<string, ServerConfig> = SERVER_REGISTRY,
  defaults: Record<string, string> = BUILTIN_DEFAULT_SERVERS
): ServerConfig | null {
  if (preferredServer) {
    const cfg = registry[preferredServer];
    if (cfg && cfg.extensions.includes(ext)) return cfg;
    if (cfg) return cfg; // even if extension doesn't match, trust the user
    return null;
  }

  const defaultServer = defaults[ext];
  if (defaultServer && registry[defaultServer]) return registry[defaultServer];

  const candidates = Object.entries(registry).filter(([, cfg]) =>
    cfg.extensions.includes(ext)
  );
  return candidates[0]?.[1] ?? null;
}

/** Find the server name key in the registry. */
export function findServerName(
  config: ServerConfig,
  registry: Record<string, ServerConfig> = SERVER_REGISTRY
): string {
  for (const [name, cfg] of Object.entries(registry)) {
    if (cfg === config) return name;
  }
  return "unknown";
}

export function getLanguageId(config: ServerConfig, ext: string): string {
  return config.languageIds[ext] ?? ext;
}
