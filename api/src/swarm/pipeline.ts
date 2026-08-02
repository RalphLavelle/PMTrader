import {
  aggregateSignals,
  assessRisk,
  buildMarketSnapshot,
  buildRecommendation,
  deriveFeatures,
  evaluateMeanReversion,
  evaluateSemantic,
  evaluateTrend,
} from '../agents/index.js';
import { AGENT_NAMES } from '../agents/names.js';
import { jupiter } from '../jupiter/index.js';
import type {
  AgentSignal,
  DerivedFeatures,
  MarketSnapshot,
  RiskAssessment,
  SwarmRecommendation,
} from '../schemas/index.js';
import { configuredRiskLimits } from './tools/risk.tool.js';

/** The complete set of artefacts a single analysis produces. */
export interface AnalysisOutputs {
  snapshot: MarketSnapshot;
  features: DerivedFeatures;
  signals: AgentSignal[];
  riskAssessment: RiskAssessment;
  recommendation: SwarmRecommendation;
}

/**
 * Apply the Risk Manager's business logic to a set of signals.
 *
 * Shared by both execution paths. The LLM swarm normally reaches this through
 * the `assess_risk` tool, but the runner also calls it directly if the model
 * finished without invoking that tool — the swarm must never return an
 * un-risk-checked recommendation.
 */
export function finaliseAnalysis(
  marketId: string,
  snapshot: MarketSnapshot,
  features: DerivedFeatures,
  signals: AgentSignal[],
): { riskAssessment: RiskAssessment; recommendation: SwarmRecommendation } {
  const proposal = aggregateSignals(marketId, signals);
  const riskAssessment = assessRisk(proposal, snapshot, features, configuredRiskLimits);
  const recommendation = buildRecommendation(proposal, riskAssessment);

  return { riskAssessment, recommendation };
}

/**
 * Fetch Jupiter market data and derive features.
 *
 * Shared by the deterministic pipeline and the LLM swarm. Pre-fetching here
 * keeps analysis working even when the model skips tool calls (common with
 * local Ollama models that do not reliably invoke functions).
 */
export async function fetchMarketContext(marketId: string): Promise<{
  snapshot: MarketSnapshot;
  features: DerivedFeatures;
}> {
  const [market, orderbook] = await Promise.all([
    jupiter.getMarket(marketId),
    jupiter.getOrderbook(marketId),
  ]);

  const snapshot = buildMarketSnapshot(market, orderbook);
  const features = deriveFeatures(snapshot);

  return { snapshot, features };
}

/**
 * Fill in any specialist signals the swarm skipped.
 *
 * Local models such as Ollama often fail to invoke tools reliably. Rather than
 * return an empty analysis, we run the pure business logic for any missing
 * agent so both execution paths produce comparable output.
 */
export async function ensureSpecialistSignals(
  snapshot: MarketSnapshot,
  features: DerivedFeatures,
  signals: AgentSignal[],
): Promise<AgentSignal[]> {
  const byAgent = new Map(signals.map((signal) => [signal.agent, signal]));

  if (!byAgent.has(AGENT_NAMES.trend)) {
    byAgent.set(AGENT_NAMES.trend, evaluateTrend(snapshot, features));
  }

  if (!byAgent.has(AGENT_NAMES.meanReversion)) {
    byAgent.set(AGENT_NAMES.meanReversion, evaluateMeanReversion(snapshot, features));
  }

  if (!byAgent.has(AGENT_NAMES.semantic)) {
    byAgent.set(AGENT_NAMES.semantic, await evaluateSemantic(snapshot));
  }

  return [...byAgent.values()];
}

/**
 * Run every specialist in a fixed order, without any LLM orchestration.
 *
 * This is the fallback used when no model is configured, and it doubles as a
 * reference implementation: it exercises exactly the same business logic the
 * agents call through their tools, so the two paths can be compared directly.
 */
export async function runDeterministicPipeline(marketId: string): Promise<AnalysisOutputs> {
  const { snapshot, features } = await fetchMarketContext(marketId);

  // The semantic evaluator degrades to a neutral signal without a model, so it
  // is safe to call here even though this is the no-LLM path.
  const signals: AgentSignal[] = [
    evaluateTrend(snapshot, features),
    evaluateMeanReversion(snapshot, features),
    await evaluateSemantic(snapshot),
  ];

  const { riskAssessment, recommendation } = finaliseAnalysis(
    marketId,
    snapshot,
    features,
    signals,
  );

  return { snapshot, features, signals, riskAssessment, recommendation };
}
