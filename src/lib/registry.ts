import type { Manifest, Registry } from '../types.js';

const DEFAULT_OWNER = 'hnkatze';
const DEFAULT_REPO = 'claude-rules-content';
const DEFAULT_BRANCH = 'main';

interface RegistryUrls {
  rawBase: string;
  apiBase: string;
  branch: string;
}

function getRegistryUrls(): RegistryUrls {
  const override = process.env.CLAUDE_RULES_REGISTRY;
  if (override) {
    const [path, branch = DEFAULT_BRANCH] = override.split('#');
    if (!path) throw new Error('Invalid CLAUDE_RULES_REGISTRY (expected <owner>/<repo>[#<branch>])');
    const [owner, repo] = path.split('/');
    if (!owner || !repo) throw new Error('Invalid CLAUDE_RULES_REGISTRY (expected <owner>/<repo>[#<branch>])');
    return {
      rawBase: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`,
      apiBase: `https://api.github.com/repos/${owner}/${repo}`,
      branch,
    };
  }
  return {
    rawBase: `https://raw.githubusercontent.com/${DEFAULT_OWNER}/${DEFAULT_REPO}/${DEFAULT_BRANCH}`,
    apiBase: `https://api.github.com/repos/${DEFAULT_OWNER}/${DEFAULT_REPO}`,
    branch: DEFAULT_BRANCH,
  };
}

async function fetchJson<T>(url: string, errLabel: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`${errLabel} not found (404): ${url}`);
    throw new Error(`Failed to fetch ${errLabel} (${res.status}): ${url}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchRegistry(): Promise<Registry> {
  const { rawBase } = getRegistryUrls();
  return fetchJson<Registry>(`${rawBase}/registry.json`, 'registry');
}

export async function fetchManifest(packName: string): Promise<Manifest> {
  const { rawBase } = getRegistryUrls();
  return fetchJson<Manifest>(`${rawBase}/packs/${packName}/manifest.json`, `manifest for '${packName}'`);
}

interface TreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
}

interface TreeResponse {
  tree: TreeItem[];
  truncated: boolean;
}

let cachedTree: TreeResponse | null = null;

async function getRepoTree(): Promise<TreeResponse> {
  if (cachedTree) return cachedTree;
  const { apiBase, branch } = getRegistryUrls();
  cachedTree = await fetchJson<TreeResponse>(
    `${apiBase}/git/trees/${branch}?recursive=1`,
    'repo tree',
  );
  if (cachedTree.truncated) {
    throw new Error('Registry repo tree is too large (>100k entries) — partial fetching not implemented yet');
  }
  return cachedTree;
}

export async function listPackFiles(packName: string): Promise<string[]> {
  const tree = await getRepoTree();
  const prefix = `packs/${packName}/`;
  return tree.tree
    .filter(t => t.type === 'blob' && t.path.startsWith(prefix) && t.path !== `${prefix}manifest.json`)
    .map(t => t.path.slice(prefix.length));
}

export async function fetchPackFile(packName: string, relPath: string): Promise<string> {
  const { rawBase } = getRegistryUrls();
  const url = `${rawBase}/packs/${packName}/${relPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${packName}/${relPath}: ${res.status}`);
  return res.text();
}
