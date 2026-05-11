export interface Manifest {
  schemaVersion?: 1 | 2;
  name: string;
  version: string;
  description: string;
  tags: string[];
  dependencies: string[];
  meta: boolean;
  mcps: McpEntry[];
  agents?: string[];
  hooks?: HooksBlock;
  settings?: SettingsBlock;
}

export interface McpEntry {
  name: string;
  config: McpConfig;
}

export interface McpConfig {
  type?: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface HooksBlock {
  scripts?: string[];
  settings?: HookSetting[];
}

export type HookEvent = 'PostToolUse' | 'PreToolUse' | 'SessionStart' | 'UserPromptSubmit';

export interface HookSetting {
  event: HookEvent;
  matcher?: string;
  command: string;
  statusMessage?: string;
  timeout?: number;
}

export interface SettingsBlock {
  env?: Record<string, string>;
  permissions?: { allow?: string[] };
  extraKnownMarketplaces?: Record<string, unknown>;
  enabledPlugins?: Record<string, boolean>;
}

export interface RegistryEntry {
  meta: boolean;
  tags: string[];
  description: string;
}

export interface Registry {
  schemaVersion: number;
  updatedAt: string;
  packs: Record<string, RegistryEntry>;
}

export interface ProjectConfig {
  packs: Record<string, string>;
}

export interface LockfileEntry {
  version: string;
  files: string[];
  mcps: string[];
  dependencies: string[];
  agents?: string[];
  hookScripts?: string[];
  settingsKeys?: SettingsOwnership;
}

export interface SettingsOwnership {
  envKeys?: string[];
  permissionsAllow?: string[];
  marketplaceKeys?: string[];
  pluginKeys?: string[];
  hookCommands?: string[];
}

export interface Lockfile {
  lockfileVersion: number;
  packs: Record<string, LockfileEntry>;
}

export interface InstallResult {
  manifest: Manifest;
  files: string[];
  mcps: string[];
  agents: string[];
  hookScripts: string[];
  settingsKeys: SettingsOwnership;
}
