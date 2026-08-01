import { ToolMessage } from '@langchain/core/messages';
import type { ToolRunnableConfig } from '@langchain/core/tools';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import type { AgentAnalysisStateType } from '../state.js';

/**
 * Helpers shared by every swarm tool.
 *
 * The tools are the bridge between the LLM-driven agent loop and the pure
 * business logic in `src/agents`. Keeping the plumbing here means each tool file
 * reads as "gather inputs, call the logic, record the result".
 */

/** Read the state of the agent currently executing this tool. */
export function readAgentState(): AgentAnalysisStateType {
  return getCurrentTaskInput() as AgentAnalysisStateType;
}

/**
 * Build the `Command` a tool returns to write into shared state.
 *
 * Two things must happen together. The state update carries the structured
 * result onward to other agents, and the `ToolMessage` answers the model's tool
 * call — omit it and the agent loop stalls waiting for a reply it never gets.
 */
export function recordToolResult(
  config: ToolRunnableConfig,
  summary: string,
  update: Partial<AgentAnalysisStateType>,
): Command {
  const toolCall = config.toolCall;

  return new Command({
    update: {
      ...update,
      messages: [
        new ToolMessage({
          content: summary,
          tool_call_id: toolCall?.id ?? '',
          name: toolCall?.name,
        }),
      ],
    },
  });
}

/**
 * Report a recoverable failure back to the model.
 *
 * The error is written to the shared `errors` channel so the Risk Manager can
 * take it into account, and returned as text so the agent can react rather than
 * the whole run throwing.
 */
export function recordToolError(config: ToolRunnableConfig, message: string): Command {
  return recordToolResult(config, `Error: ${message}`, { errors: [message] });
}
