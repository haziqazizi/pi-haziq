function normalizePromptText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function hasPiHaziqContract(prompt: string, policy: string): boolean {
  const normalizedPolicy = normalizePromptText(policy);
  return normalizedPolicy.length > 0 && normalizePromptText(prompt).includes(normalizedPolicy);
}

export function appendPiHaziqContract(systemPrompt: string, policy: string): string {
  if (hasPiHaziqContract(systemPrompt, policy)) return systemPrompt;
  return `${systemPrompt}\n\n${normalizePromptText(policy)}`;
}
