export type IntentEnv = Record<string, string | undefined>;

/**
 * Feature flag for AI-first structured intent extraction.
 * Disabled unless explicitly set to true/1/on/yes.
 */
export function isAiIntentExtractionEnabled(
  env: IntentEnv = process.env
): boolean {
  const raw = env.AI_INTENT_EXTRACTION_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}
