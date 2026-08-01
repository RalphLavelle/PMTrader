import { randomUUID } from 'node:crypto';
import { AGENT_NAMES } from '../agents/names.js';
import {
  analysisRecordSchema,
  type AgentName,
  type AgentSignal,
  type AnalysisRecord,
  type Confidence,
  type RiskAssessment,
  type SwarmRecommendation,
} from '../schemas/index.js';

/** Everything needed to turn a finished run into a persistable record. */
export interface AnalysisRecordInput {
  marketId: string;
  signals: AgentSignal[];
  riskAssessment: RiskAssessment | null;
  recommendation: SwarmRecommendation;
  /** Whether the run went through the LLM swarm or the deterministic fallback. */
  mode: 'swarm' | 'deterministic';
  timestamp?: Date;
}

/**
 * Assemble the memory record for a completed analysis.
 *
 * The shape is fixed by the memory contract: timestamp, market id, participating
 * agents, individual confidence scores, the final recommendation, and a slot for
 * the outcome that gets filled in later once the market resolves.
 */
export function buildAnalysisRecord(input: AnalysisRecordInput): AnalysisRecord {
  const timestamp = (input.timestamp ?? new Date()).toISOString();

  const confidenceScores: Partial<Record<AgentName, Confidence>> = {};
  for (const signal of input.signals) {
    confidenceScores[signal.agent] = signal.confidence;
  }

  // The Market Analyst prepares data without emitting a signal, and the Risk
  // Manager decides without one, so both are added explicitly when they ran.
  const participatingAgents: AgentName[] = [
    AGENT_NAMES.marketAnalyst,
    ...input.signals.map((signal) => signal.agent),
  ];

  if (input.riskAssessment) {
    participatingAgents.push(AGENT_NAMES.riskManager);
  }

  return analysisRecordSchema.parse({
    id: randomUUID(),
    timestamp,
    marketId: input.marketId,
    participatingAgents: [...new Set(participatingAgents)],
    confidenceScores,
    signals: input.signals,
    riskAssessment: input.riskAssessment,
    recommendation: input.recommendation,
    outcome: null,
    mode: input.mode,
  });
}
