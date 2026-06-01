/**
 * Language and language server configurations.
 */

export interface LanguageConfig {
  extensions: string[];
  languageId: string;
  servers: string[];
}

export interface ServerDefinition {
  name: string;
  command: string;
  args: string[];
  transport?: "stdio";
  rootMarkers?: string[];
  initializationOptions?: Record<string, unknown>;
  env?: Record<string, string>;
}

/** Runtime server config used by the LSP client. */
export interface ServerConfig extends ServerDefinition {
  extensions: string[];
  languageIds: Record<string, string>;
}

export const LANGUAGE_REGISTRY: Record<string, LanguageConfig> = {
  python: {
    extensions: ["py", "pyi"],
    languageId: "python",
    servers: ["pyright", "pylsp"],
  },
  typescript: {
    extensions: ["ts"],
    languageId: "typescript",
    servers: ["typescript"],
  },
  typescriptreact: {
    extensions: ["tsx"],
    languageId: "typescriptreact",
    servers: ["typescript"],
  },
  javascript: {
    extensions: ["js", "mjs", "cjs"],
    languageId: "javascript",
    servers: ["typescript"],
  },
  javascriptreact: {
    extensions: ["jsx"],
    languageId: "javascriptreact",
    servers: ["typescript"],
  },
  rust: {
    extensions: ["rs"],
    languageId: "rust",
    servers: ["rust-analyzer"],
  },
};

export const SERVER_DEFINITIONS: Record<string, ServerDefinition> = {
  pyright: {
    name: "Pyright",
    command: "pyright-langserver",
    args: ["--stdio"],
    transport: "stdio",
    rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg"],
  },
  pylsp: {
    name: "Python LSP Server (pylsp)",
    command: "pylsp",
    args: [],
    transport: "stdio",
    rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg"],
  },
  typescript: {
    name: "TypeScript Language Server",
    command: "typescript-language-server",
    args: ["--stdio"],
    transport: "stdio",
    rootMarkers: ["package.json", "tsconfig.json"],
  },
  "rust-analyzer": {
    name: "Rust Analyzer",
    command: "rust-analyzer",
    args: [],
    transport: "stdio",
    rootMarkers: ["Cargo.toml", "rust-project.json"],
  },
};

export const BUILTIN_ROOT_MARKERS = [
  "package.json", "tsconfig.json", "pyproject.toml",
  "setup.py", "setup.cfg", ".git", "Cargo.toml", "rust-project.json", "go.mod",
  "pom.xml", "build.gradle",
];

export function buildRuntimeRegistry(
  servers: Record<string, ServerDefinition>,
  languages: Record<string, LanguageConfig>
): Record<string, ServerConfig> {
  const registry: Record<string, ServerConfig> = {};

  for (const [id, server] of Object.entries(servers)) {
    registry[id] = { ...server, args: server.args ?? [], transport: "stdio", extensions: [], languageIds: {} };
  }

  for (const language of Object.values(languages)) {
    for (const serverId of language.servers) {
      const server = registry[serverId];
      if (!server) continue;
      for (const ext of language.extensions) {
        if (!server.extensions.includes(ext)) server.extensions.push(ext);
        server.languageIds[ext] = language.languageId;
      }
    }
  }

  return registry;
}

export const SERVER_REGISTRY: Record<string, ServerConfig> = buildRuntimeRegistry(SERVER_DEFINITIONS, LANGUAGE_REGISTRY);

export const BUILTIN_DEFAULT_SERVERS: Record<string, string> = Object.fromEntries(
  Object.values(LANGUAGE_REGISTRY).flatMap((language) =>
    language.extensions.map((ext) => [ext, language.servers[0]])
  )
);

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
