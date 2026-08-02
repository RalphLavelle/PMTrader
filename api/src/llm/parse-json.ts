/**
 * Parse JSON returned by local models such as Ollama.
 *
 * Many models wrap JSON in markdown fences (```json ... ```) even when asked
 * not to. This helper strips those wrappers before parsing.
 */
export function extractJsonFromLlmResponse(text: string): string {
  const trimmed = text.trim();

  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
}

/** Parse and validate JSON text from an LLM response. */
export function parseLlmJson<T>(text: string, parse: (value: unknown) => T): T {
  const jsonText = extractJsonFromLlmResponse(text);
  return parse(JSON.parse(jsonText));
}
