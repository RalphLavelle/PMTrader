import { ChatOpenAI } from '@langchain/openai';
import { config } from '../config.js';

/** Returns a chat model when configured; otherwise null (nodes use placeholder logic). */
export function createChatModel(): ChatOpenAI | null {
  if (!config.openAiApiKey) {
    return null;
  }

  return new ChatOpenAI({
    apiKey: config.openAiApiKey,
    model: config.openAiModel,
    temperature: 0.2,
  });
}
