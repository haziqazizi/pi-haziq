const SERVICE_TIER_STATUS_KEY = "pi-openai-service-tier";

export { SERVICE_TIER_STATUS_KEY };

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/** Hide long unsupported-model warnings; keep active tier labels only. */
export function quietServiceTierStatusText(text: string | undefined): string | undefined {
  if (text === undefined || text === null || text === "") return undefined;
  if (/unsupported/i.test(stripAnsi(text))) return undefined;
  return text;
}
