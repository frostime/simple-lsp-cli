import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  BUILTIN_DEFAULT_SERVERS,
  BUILTIN_ROOT_MARKERS,
  SERVER_REGISTRY,
  type ServerConfig,
} from "./servers.js";

export const CONFIG_FILE_NAME = "slsp.config.json";
export const CURRENT_CONFIG_SCHEMA_VERSION = "1.0";

export interface SlspConfig {
  $schema?: string;
  schemaVersion: "1.0";
  servers?: Record<string, ServerConfig>;
  defaults?: Record<string, string>;
}

export interface LoadedSlspConfig {
  path: string;
  config: SlspConfig;
}

export interface EffectiveConfig {
  configPath?: string;
  registry: Record<string, ServerConfig>;
  defaults: Record<string, string>;
  fingerprint: string;
}

export class ConfigError extends Error {
  readonly code = "config_error";

  constructor(
    message: string,
    readonly file?: string,
    readonly configPath?: string
  ) {
    super(message);
    this.name = "ConfigError";
  }

  toJson() {
    return {
      code: this.code,
      message: this.message,
      ...(this.configPath ? { file: this.configPath } : {}),
    };
  }
}

export function findConfig(startPath: string): string | null {
  let dir = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
    ? path.resolve(startPath)
    : path.dirname(path.resolve(startPath));
  const root = path.parse(dir).root;

  while (true) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

export function loadSlspConfig(startPath: string): LoadedSlspConfig | null {
  const configPath = findConfig(startPath);
  if (!configPath) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new ConfigError(
      `Invalid JSON in ${CONFIG_FILE_NAME}: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      configPath
    );
  }

  const config = validateConfig(raw, configPath);
  return { path: configPath, config };
}

export function loadEffectiveConfig(startPath: string): EffectiveConfig {
  const loaded = loadSlspConfig(startPath);
  const registry = mergeServerRegistry(SERVER_REGISTRY, loaded?.config ?? null);
  const defaults = mergeDefaults(BUILTIN_DEFAULT_SERVERS, loaded?.config ?? null);
  validateDefaults(defaults, registry, loaded?.path);

  return {
    configPath: loaded?.path,
    registry,
    defaults,
    fingerprint: fingerprintEffectiveConfig(registry, defaults, loaded?.path),
  };
}

export function mergeServerRegistry(
  builtin: Record<string, ServerConfig>,
  config: SlspConfig | null
): Record<string, ServerConfig> {
  return { ...builtin, ...(config?.servers ?? {}) };
}

export function mergeDefaults(
  builtin: Record<string, string>,
  config: SlspConfig | null
): Record<string, string> {
  return { ...builtin, ...(config?.defaults ?? {}) };
}

export function getRootMarkers(server?: ServerConfig): string[] {
  return [...(server?.rootMarkers ?? []), ...BUILTIN_ROOT_MARKERS];
}

export function fingerprintEffectiveConfig(
  registry: Record<string, ServerConfig>,
  defaults: Record<string, string>,
  configPath?: string
): string {
  const stable = JSON.stringify(sortValue({ registry, defaults, configPath: configPath ? path.resolve(configPath) : null }));
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function validateConfig(raw: unknown, configPath: string): SlspConfig {
  const obj = expectObject(raw, "config", configPath);

  if (obj.schemaVersion !== CURRENT_CONFIG_SCHEMA_VERSION) {
    throw new ConfigError(
      `Unsupported schemaVersion: ${String(obj.schemaVersion)}. Expected ${CURRENT_CONFIG_SCHEMA_VERSION}`,
      undefined,
      configPath
    );
  }

  if (obj.$schema !== undefined && typeof obj.$schema !== "string") {
    throw new ConfigError("$schema must be a string", undefined, configPath);
  }

  const servers = obj.servers === undefined
    ? undefined
    : validateServers(obj.servers, configPath);
  const defaults = obj.defaults === undefined
    ? undefined
    : validateStringRecord(obj.defaults, "defaults", configPath);

  const config: SlspConfig = {
    ...(obj.$schema ? { $schema: obj.$schema as string } : {}),
    schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
    ...(servers ? { servers } : {}),
    ...(defaults ? { defaults } : {}),
  };

  const mergedRegistry = mergeServerRegistry(SERVER_REGISTRY, config);
  const mergedDefaults = mergeDefaults(BUILTIN_DEFAULT_SERVERS, config);
  validateDefaults(mergedDefaults, mergedRegistry, configPath);

  return config;
}

function validateServers(raw: unknown, configPath: string): Record<string, ServerConfig> {
  const obj = expectObject(raw, "servers", configPath);
  const servers: Record<string, ServerConfig> = {};

  for (const [id, value] of Object.entries(obj)) {
    if (!id.trim()) throw new ConfigError("servers contains an empty id", undefined, configPath);
    servers[id] = validateServer(value, `servers.${id}`, configPath);
  }

  return servers;
}

function validateServer(raw: unknown, label: string, configPath: string): ServerConfig {
  const obj = expectObject(raw, label, configPath);
  const command = expectString(obj.command, `${label}.command`, configPath);
  const args = obj.args === undefined ? [] : validateStringArray(obj.args, `${label}.args`, configPath);
  const transport = obj.transport === undefined ? "stdio" : expectString(obj.transport, `${label}.transport`, configPath);
  if (transport !== "stdio") {
    throw new ConfigError(`${label}.transport must be "stdio"`, undefined, configPath);
  }

  const extensions = validateStringArray(obj.extensions, `${label}.extensions`, configPath);
  for (const ext of extensions) {
    if (ext.startsWith(".")) {
      throw new ConfigError(`${label}.extensions entries must not start with '.'`, undefined, configPath);
    }
  }

  return {
    name: obj.name === undefined ? command : expectString(obj.name, `${label}.name`, configPath),
    command,
    args,
    transport: "stdio",
    extensions,
    languageIds: validateStringRecord(obj.languageIds, `${label}.languageIds`, configPath),
    ...(obj.rootMarkers === undefined ? {} : { rootMarkers: validateStringArray(obj.rootMarkers, `${label}.rootMarkers`, configPath) }),
    ...(obj.initializationOptions === undefined ? {} : { initializationOptions: expectObject(obj.initializationOptions, `${label}.initializationOptions`, configPath) }),
    ...(obj.env === undefined ? {} : { env: validateStringRecord(obj.env, `${label}.env`, configPath) }),
  };
}

function validateDefaults(defaults: Record<string, string>, registry: Record<string, ServerConfig>, configPath?: string): void {
  for (const [ext, serverId] of Object.entries(defaults)) {
    if (ext.startsWith(".")) {
      throw new ConfigError("defaults keys must not start with '.'", undefined, configPath);
    }
    const server = registry[serverId];
    if (!server) {
      throw new ConfigError(`defaults.${ext} references unknown server: ${serverId}`, undefined, configPath);
    }
    if (!server.extensions.includes(ext)) {
      throw new ConfigError(`defaults.${ext} references ${serverId}, but ${serverId}.extensions does not include ${ext}`, undefined, configPath);
    }
  }
}

function expectObject(raw: unknown, label: string, configPath: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`${label} must be an object`, undefined, configPath);
  }
  return raw as Record<string, unknown>;
}

function expectString(raw: unknown, label: string, configPath: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ConfigError(`${label} must be a non-empty string`, undefined, configPath);
  }
  return raw;
}

function validateStringArray(raw: unknown, label: string, configPath: string): string[] {
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || v.length === 0)) {
    throw new ConfigError(`${label} must be an array of non-empty strings`, undefined, configPath);
  }
  return raw;
}

function validateStringRecord(raw: unknown, label: string, configPath: string): Record<string, string> {
  const obj = expectObject(raw, label, configPath);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = expectString(value, `${label}.${key}`, configPath);
  }
  return out;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, sortValue(val)])
  );
}
