import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  BUILTIN_DEFAULT_SERVERS,
  BUILTIN_ROOT_MARKERS,
  LANGUAGE_REGISTRY,
  SERVER_DEFINITIONS,
  SERVER_REGISTRY,
  buildRuntimeRegistry,
  type LanguageConfig,
  type ServerConfig,
  type ServerDefinition,
} from "./servers.js";

export const CONFIG_FILE_NAME = "slsp.config.json";
export const CURRENT_CONFIG_SCHEMA_VERSION = "2.0";

export interface SlspConfigV1 {
  $schema?: string;
  schemaVersion: "1.0";
  servers?: Record<string, ServerConfig>;
  defaults?: Record<string, string>;
}

export interface SlspConfig {
  $schema?: string;
  schemaVersion: "2.0";
  languages?: Record<string, LanguageConfig>;
  servers?: Record<string, ServerDefinition>;
}

export interface LoadedSlspConfig {
  path: string;
  config: SlspConfig;
}

export interface EffectiveConfig {
  configPath?: string;
  configPaths: {
    global?: string;
    project?: string;
  };
  languages: Record<string, LanguageConfig>;
  servers: Record<string, ServerDefinition>;
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

export function findGlobalConfig(): string | null {
  const configHome = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.length > 0
    ? process.env.XDG_CONFIG_HOME
    : path.join(os.homedir(), ".config");
  const candidate = path.join(configHome, "simple-lsp-cli", CONFIG_FILE_NAME);
  return fs.existsSync(candidate) ? candidate : null;
}

export function loadSlspConfig(startPath: string): LoadedSlspConfig | null {
  const configPath = findConfig(startPath);
  if (!configPath) return null;
  return { path: configPath, config: readConfigFile(configPath) };
}

export function loadGlobalSlspConfig(): LoadedSlspConfig | null {
  const configPath = findGlobalConfig();
  if (!configPath) return null;
  return { path: configPath, config: readConfigFile(configPath) };
}

export function loadEffectiveConfig(startPath: string): EffectiveConfig {
  const global = loadGlobalSlspConfig();
  const project = loadSlspConfig(startPath);

  const languages = mergeLanguages(
    LANGUAGE_REGISTRY,
    global?.config.languages ?? null,
    project?.config.languages ?? null
  );
  const servers = mergeServerDefinitions(
    SERVER_DEFINITIONS,
    global?.config.servers ?? null,
    project?.config.servers ?? null
  );
  validateLanguages(languages, servers, project?.path ?? global?.path);
  const registry = buildRuntimeRegistry(servers, languages);
  const defaults = buildDefaults(languages);
  validateDefaults(defaults, registry, project?.path ?? global?.path);

  return {
    configPath: project?.path,
    configPaths: {
      ...(global?.path ? { global: global.path } : {}),
      ...(project?.path ? { project: project.path } : {}),
    },
    languages,
    servers,
    registry,
    defaults,
    fingerprint: fingerprintEffectiveConfig(registry, defaults, { global: global?.path, project: project?.path }, languages),
  };
}

export function mergeServerRegistry(
  builtin: Record<string, ServerConfig>,
  config: SlspConfig | SlspConfigV1 | null
): Record<string, ServerConfig> {
  if (!config) return { ...builtin };
  if (config.schemaVersion === "2.0") {
    return buildRuntimeRegistry(mergeServerDefinitions(SERVER_DEFINITIONS, config.servers ?? null), mergeLanguages(LANGUAGE_REGISTRY, config.languages ?? null));
  }
  return { ...builtin, ...(config.servers ?? {}) };
}

export function mergeDefaults(
  builtin: Record<string, string>,
  config: SlspConfig | SlspConfigV1 | null
): Record<string, string> {
  if (!config) return { ...builtin };
  if (config.schemaVersion === "2.0") return buildDefaults(mergeLanguages(LANGUAGE_REGISTRY, config.languages ?? null));
  return { ...builtin, ...(config.defaults ?? {}) };
}

export function mergeLanguages(
  builtin: Record<string, LanguageConfig>,
  ...configs: Array<Record<string, LanguageConfig> | null>
): Record<string, LanguageConfig> {
  return Object.assign({}, builtin, ...configs.filter(Boolean));
}

export function mergeServerDefinitions(
  builtin: Record<string, ServerDefinition>,
  ...configs: Array<Record<string, ServerDefinition> | null>
): Record<string, ServerDefinition> {
  return Object.assign({}, builtin, ...configs.filter(Boolean));
}

export function buildDefaults(languages: Record<string, LanguageConfig>): Record<string, string> {
  return Object.fromEntries(
    Object.values(languages).flatMap((language) =>
      language.extensions.map((ext) => [ext, language.servers[0]])
    )
  );
}

export function getRootMarkers(server?: ServerConfig | ServerDefinition): string[] {
  return [...(server?.rootMarkers ?? []), ...BUILTIN_ROOT_MARKERS];
}

export function fingerprintEffectiveConfig(
  registry: Record<string, ServerConfig>,
  defaults: Record<string, string>,
  configPaths?: { global?: string; project?: string },
  languages?: Record<string, LanguageConfig>
): string {
  const stable = JSON.stringify(sortValue({
    registry,
    defaults,
    languages,
    configPaths: {
      global: configPaths?.global ? path.resolve(configPaths.global) : null,
      project: configPaths?.project ? path.resolve(configPaths.project) : null,
    },
  }));
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function readConfigFile(configPath: string): SlspConfig {
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

  return validateConfig(migrateConfig(raw, configPath), configPath);
}

function migrateConfig(raw: unknown, configPath: string): unknown {
  const obj = expectObject(raw, "config", configPath);
  const schemaVersion = obj.schemaVersion === undefined ? "0.0" : expectString(obj.schemaVersion, "schemaVersion", configPath);

  if (compareSchemaVersion(schemaVersion, CURRENT_CONFIG_SCHEMA_VERSION) > 0) {
    throw new ConfigError(`Unsupported future schemaVersion: ${schemaVersion}`, undefined, configPath);
  }

  let result: Record<string, unknown> = { ...obj };
  let current = schemaVersion;
  const migrations = [
    { version: "1.0", migrate: migrateTo1_0 },
    { version: "2.0", migrate: (data: Record<string, unknown>) => migrateTo2_0(data, configPath) },
  ].sort((a, b) => compareSchemaVersion(a.version, b.version));

  for (const entry of migrations) {
    if (compareSchemaVersion(current, entry.version) < 0) {
      result = entry.migrate(result);
      current = entry.version;
    }
  }

  result.schemaVersion = CURRENT_CONFIG_SCHEMA_VERSION;
  return result;
}

function migrateTo1_0(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data, schemaVersion: "1.0" };
}

function migrateTo2_0(data: Record<string, unknown>, configPath: string): Record<string, unknown> {
  const v1 = validateConfigV1(data, configPath);
  const languages: Record<string, LanguageConfig> = {};
  const servers: Record<string, ServerDefinition> = {};

  for (const [serverId, server] of Object.entries(v1.servers ?? {})) {
    const { extensions: _extensions, languageIds: _languageIds, ...definition } = server;
    servers[serverId] = definition;
  }

  const extCandidates = new Map<string, string[]>();
  for (const [serverId, server] of Object.entries(v1.servers ?? {})) {
    for (const ext of server.extensions) {
      extCandidates.set(ext, [...(extCandidates.get(ext) ?? []), serverId]);
    }
  }

  for (const [ext, serverId] of Object.entries(v1.defaults ?? {})) {
    const server = v1.servers?.[serverId];
    if (!server) {
      throw new ConfigError(`defaults.${ext} references unknown server: ${serverId}`, undefined, configPath);
    }
    if (!server.extensions.includes(ext)) {
      throw new ConfigError(`defaults.${ext} references ${serverId}, but ${serverId}.extensions does not include ${ext}`, undefined, configPath);
    }
  }

  for (const [serverId, server] of Object.entries(v1.servers ?? {})) {
    for (const ext of server.extensions) {
      const selected = v1.defaults?.[ext] ?? singleCandidate(ext, extCandidates.get(ext) ?? [], configPath);
      if (selected !== serverId) continue;
      const languageId = server.languageIds[ext] ?? ext;
      const languageKey = languageId;
      const language = languages[languageKey] ?? { extensions: [], languageId, servers: [] };
      if (!language.extensions.includes(ext)) language.extensions.push(ext);
      if (!language.servers.includes(serverId)) language.servers.push(serverId);
      languages[languageKey] = language;
    }
  }

  return {
    ...(v1.$schema ? { $schema: v1.$schema } : {}),
    schemaVersion: "2.0",
    ...(Object.keys(languages).length ? { languages } : {}),
    ...(Object.keys(servers).length ? { servers } : {}),
  };
}

function singleCandidate(ext: string, candidates: string[], configPath: string): string {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) throw new ConfigError(`No server declares extension: ${ext}`, undefined, configPath);
  throw new ConfigError(`Multiple servers declare extension ${ext}; configure defaults.${ext}`, undefined, configPath);
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
    : validateServerDefinitions(obj.servers, configPath);
  const languages = obj.languages === undefined
    ? undefined
    : validateLanguageConfigs(obj.languages, configPath);

  return {
    ...(obj.$schema ? { $schema: obj.$schema as string } : {}),
    schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
    ...(languages ? { languages } : {}),
    ...(servers ? { servers } : {}),
  };
}

function validateConfigV1(raw: unknown, configPath: string): SlspConfigV1 {
  const obj = expectObject(raw, "config", configPath);

  if (obj.schemaVersion !== "1.0") {
    throw new ConfigError(`Unsupported schemaVersion: ${String(obj.schemaVersion)}. Expected 1.0`, undefined, configPath);
  }

  if (obj.$schema !== undefined && typeof obj.$schema !== "string") {
    throw new ConfigError("$schema must be a string", undefined, configPath);
  }

  const servers = obj.servers === undefined
    ? undefined
    : validateServersV1(obj.servers, configPath);
  const defaults = obj.defaults === undefined
    ? undefined
    : validateStringRecord(obj.defaults, "defaults", configPath);

  return {
    ...(obj.$schema ? { $schema: obj.$schema as string } : {}),
    schemaVersion: "1.0",
    ...(servers ? { servers } : {}),
    ...(defaults ? { defaults } : {}),
  };
}

function validateServersV1(raw: unknown, configPath: string): Record<string, ServerConfig> {
  const obj = expectObject(raw, "servers", configPath);
  const servers: Record<string, ServerConfig> = {};

  for (const [id, value] of Object.entries(obj)) {
    if (!id.trim()) throw new ConfigError("servers contains an empty id", undefined, configPath);
    servers[id] = validateServerV1(value, `servers.${id}`, configPath);
  }

  return servers;
}

function validateServerV1(raw: unknown, label: string, configPath: string): ServerConfig {
  const obj = expectObject(raw, label, configPath);
  const command = expectString(obj.command, `${label}.command`, configPath);
  const definition = validateServerDefinition(raw, label, configPath);

  const extensions = validateStringArray(obj.extensions, `${label}.extensions`, configPath);
  for (const ext of extensions) {
    if (ext.startsWith(".")) {
      throw new ConfigError(`${label}.extensions entries must not start with '.'`, undefined, configPath);
    }
  }

  const languageIds = validateStringRecord(obj.languageIds, `${label}.languageIds`, configPath);
  for (const ext of extensions) {
    if (!(ext in languageIds)) {
      throw new ConfigError(`${label}.languageIds must include extension: ${ext}`, undefined, configPath);
    }
  }
  for (const ext of Object.keys(languageIds)) {
    if (!extensions.includes(ext)) {
      throw new ConfigError(`${label}.languageIds key is not in extensions: ${ext}`, undefined, configPath);
    }
  }

  return {
    ...definition,
    name: definition.name ?? command,
    args: definition.args ?? [],
    extensions,
    languageIds,
  };
}

function validateLanguageConfigs(raw: unknown, configPath: string): Record<string, LanguageConfig> {
  const obj = expectObject(raw, "languages", configPath);
  const languages: Record<string, LanguageConfig> = {};

  for (const [id, value] of Object.entries(obj)) {
    if (!id.trim()) throw new ConfigError("languages contains an empty id", undefined, configPath);
    languages[id] = validateLanguageConfig(value, `languages.${id}`, configPath);
  }

  return languages;
}

function validateLanguageConfig(raw: unknown, label: string, configPath: string): LanguageConfig {
  const obj = expectObject(raw, label, configPath);
  const extensions = validateStringArray(obj.extensions, `${label}.extensions`, configPath);
  if (extensions.length === 0) throw new ConfigError(`${label}.extensions must not be empty`, undefined, configPath);
  for (const ext of extensions) {
    if (ext.startsWith(".")) {
      throw new ConfigError(`${label}.extensions entries must not start with '.'`, undefined, configPath);
    }
  }
  const servers = validateStringArray(obj.servers, `${label}.servers`, configPath);
  if (servers.length === 0) throw new ConfigError(`${label}.servers must not be empty`, undefined, configPath);

  return {
    extensions,
    languageId: expectString(obj.languageId, `${label}.languageId`, configPath),
    servers,
  };
}

function validateServerDefinitions(raw: unknown, configPath: string): Record<string, ServerDefinition> {
  const obj = expectObject(raw, "servers", configPath);
  const servers: Record<string, ServerDefinition> = {};

  for (const [id, value] of Object.entries(obj)) {
    if (!id.trim()) throw new ConfigError("servers contains an empty id", undefined, configPath);
    servers[id] = validateServerDefinition(value, `servers.${id}`, configPath);
  }

  return servers;
}

function validateServerDefinition(raw: unknown, label: string, configPath: string): ServerDefinition {
  const obj = expectObject(raw, label, configPath);
  const command = expectString(obj.command, `${label}.command`, configPath);
  const args = obj.args === undefined ? [] : validateStringArray(obj.args, `${label}.args`, configPath);
  const transport = obj.transport === undefined ? "stdio" : expectString(obj.transport, `${label}.transport`, configPath);
  if (transport !== "stdio") {
    throw new ConfigError(`${label}.transport must be "stdio"`, undefined, configPath);
  }

  return {
    name: obj.name === undefined ? command : expectString(obj.name, `${label}.name`, configPath),
    command,
    args,
    transport: "stdio",
    ...(obj.rootMarkers === undefined ? {} : { rootMarkers: validateStringArray(obj.rootMarkers, `${label}.rootMarkers`, configPath) }),
    ...(obj.initializationOptions === undefined ? {} : { initializationOptions: expectObject(obj.initializationOptions, `${label}.initializationOptions`, configPath) }),
    ...(obj.env === undefined ? {} : { env: validateStringRecord(obj.env, `${label}.env`, configPath) }),
  };
}

function validateLanguages(languages: Record<string, LanguageConfig>, servers: Record<string, ServerDefinition>, configPath?: string): void {
  for (const [id, language] of Object.entries(languages)) {
    for (const serverId of language.servers) {
      if (!servers[serverId]) {
        throw new ConfigError(`languages.${id}.servers references unknown server: ${serverId}`, undefined, configPath);
      }
    }
  }
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

function compareSchemaVersion(v1: string, v2: string): number {
  const parse = (v: string) => v.split(".").map((part) => Number(part));
  const left = parse(v1);
  const right = parse(v2);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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
