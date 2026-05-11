export interface Manifest {
  name: string;
  version: string;
  description: string;
  tags: string[];
  dependencies: string[];
  meta: boolean;
  mcps: McpEntry[];
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
}

export interface Lockfile {
  lockfileVersion: number;
  packs: Record<string, LockfileEntry>;
}

export interface InstallResult {
  manifest: Manifest;
  files: string[];
  mcps: string[];
}
