import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config.js';
import { isLlmBackingOff } from './quota.js';

export {
  beginLlmBackoff,
  clearLlmBackoff,
  isLlmBackingOff,
  isLlmQuotaError,
  llmBackoffUntil,
  noteLlmFailure,
} from './quota.js';

/**
 * Returns a chat model when Ollama is configured and we are not in a quota
 * backoff; otherwise null (callers use the deterministic path).
 */
export function createChatModel(): ChatOpenAI | null {
  if (!config.llmConfigured || isLlmBackingOff()) {
    return null;
  }

  // Ollama exposes an OpenAI-compatible API — point ChatOpenAI at it via baseURL.
  return new ChatOpenAI({
    apiKey: config.ollamaApiKey || 'ollama',
    model: config.ollamaModel,
    temperature: 0.2,
    configuration: {
      baseURL: config.ollamaBaseUrl,
    },
  });
}
