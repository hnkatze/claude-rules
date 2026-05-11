# @hnkatze/claude-rules

CLI to install rules, skills, and MCPs into Claude Code projects from the [@hnkatze/claude-rules-content](https://github.com/hnkatze/claude-rules-content) registry.

## Quick start

```bash
# Initialize the project (creates claude-rules.json + managed block in CLAUDE.md)
npx @hnkatze/claude-rules init

# See what's available
npx @hnkatze/claude-rules available

# Install a stack bundle (rules + skills + MCPs)
npx @hnkatze/claude-rules add angular-stack

# List installed
npx @hnkatze/claude-rules list

# Remove
npx @hnkatze/claude-rules remove angular-stack
```

## Commands

| Command | Alias | Description |
| ------- | ----- | ----------- |
| `init` | — | Initialize project: scaffold `claude-rules.json` + managed block in `CLAUDE.md` |
| `available` | — | List packs available in the registry |
| `add <packs...>` | — | Install one or more packs (resolves deps + offers MCP installation) |
| `list` | `ls` | Show installed packs and versions |
| `remove <pack>` | `rm` | Uninstall a pack — auto-detects orphan deps and offers to clean them |
| `update [pack]` | — | Refresh installed packs to latest registry version (all or specific) |
| `sync` | — | Install + update + repair to match `claude-rules.json` (CI/teammate flow) |
| `doctor` | — | Diagnose drift: missing files, broken `CLAUDE.md` block, outdated packs |

### Flags

- `--no-mcps` (on `add`/`update`/`sync`): skip the MCP install prompt
- `-y, --yes`: skip confirmation prompts (non-interactive — answers Yes to everything)
- `--fix` (on `doctor`): auto-repair fixable findings (regenerate `CLAUDE.md` block)

## How it works

1. `init` writes `claude-rules.json` (declarative manifest of installed packs) and a managed block in `CLAUDE.md`.
2. `add <pack>` does, in order:
   - Fetches the manifest from the content registry on GitHub
   - Resolves `dependencies` recursively
   - Shows a plan of what will be installed
   - Downloads the pack files via GitHub raw URLs
   - Mirrors the pack structure into `.claude/`:
     - `packs/<name>/rules/*` → `.claude/rules/`
     - `packs/<name>/skills/<skill>/*` → `.claude/skills/<skill>/`
     - `packs/<name>/agents/*` → `.claude/agents/` (schema v2)
     - `packs/<name>/hooks/*.sh` → `.claude/hooks/` (schema v2, `chmod +x` on Unix)
   - Asks (interactive multiselect) which MCPs from the pack to merge into `.mcp.json`
   - Merges the pack's `settings` block + hook settings entries into `.claude/settings.json` (schema v2, additive only — see [docs/schema-v2.md](#schema-v2))
   - Updates `claude-rules.json`, `claude-rules.lock.json`, and the `CLAUDE.md` block
3. The `CLAUDE.md` block uses `@.claude/rules/<file>` references so Claude Code auto-loads them.

## Schema v2

The CLI supports manifest **schema v2** (additive, fully backwards compatible with v1). A v2 manifest may declare:

- `schemaVersion: 2`
- `agents: ["agents/<name>.md", ...]` — mirrored to `.claude/agents/`
- `hooks: { scripts: [...], settings: [...] }` — scripts mirrored to `.claude/hooks/`, settings merged into `.claude/settings.json`
- `settings: { env?, permissions?: { allow? }, extraKnownMarketplaces?, enabledPlugins? }` — additive only; **prohibited fields**: `language`, `outputStyle`, `voice`, `voiceEnabled`, `statusLine`, `skipDangerousModePermissionPrompt`, `permissions.deny`, `permissions.defaultMode`

### Settings merge semantics

- `env.<KEY>` — last-write-wins (warns on collision)
- `permissions.allow[]` — set union
- `extraKnownMarketplaces.<KEY>` — shallow merge (warns on collision)
- `enabledPlugins.<plugin>` — last-write-wins
- `hooks.settings[]` — appended to `.claude/settings.json` → `hooks.<event>[]`, deduped by command

### Ownership tracking

Each pack's settings additions are recorded in `claude-rules.lock.json` under `settingsKeys` (env keys, allow rules, plugin names, marketplace keys, hook commands). On uninstall, the CLI removes exactly those entries — your hand-edited settings are left intact.

v1 packs continue to install with v1 behavior (rules + skills + mcps). v2 packs installed via an older CLI degrade gracefully — `agents`, `hooks`, and `settings` are silently skipped.

## Files written to your project

| File | Purpose |
| ---- | ------- |
| `claude-rules.json` | Declarative list of installed packs (commit it) |
| `claude-rules.lock.json` | Pinned versions + installed file paths (commit it) |
| `.claude/rules/*.md` | Rule files (commit or ignore — your call) |
| `.claude/skills/*/` | Skill folders (commit or ignore) |
| `.claude/agents/*.md` | Agent definitions (schema v2) |
| `.claude/hooks/*.sh` | Hook scripts (schema v2) |
| `.claude/settings.json` | Project settings merged from packs (schema v2, additive only) |
| `.mcp.json` | MCP configs merged from packs (commit it for team) |
| `CLAUDE.md` | Managed block with `@.claude/rules/*.md` refs |

## Environment

- `CLAUDE_RULES_REGISTRY` — override the default registry. Format: `<owner>/<repo>[#<branch>]` (e.g. `hnkatze/claude-rules-content#dev`)

## Roadmap

- Custom registries (multiple sources beyond `claude-rules-content`)
- Bundles/presets via flags (e.g. `add --preset minimal`)
- Pack search/filter in `available`
- Auth support for private registries

## License

MIT
