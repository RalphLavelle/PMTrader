import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config.js';

/** Returns a chat model when Ollama is configured; otherwise null (callers use placeholder logic). */
export function createChatModel(): ChatOpenAI | null {
  if (!config.llmConfigured) {
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
