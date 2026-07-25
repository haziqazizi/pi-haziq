import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type McpConfig = Record<string, unknown> & { mcpServers?: Record<string, unknown> };
export function loadMcpConfig(overridePath?: string, cwd?: string): McpConfig;
export function createMcpAdapter(options?: { config?: McpConfig; configPath?: string }): (pi: ExtensionAPI) => void;
