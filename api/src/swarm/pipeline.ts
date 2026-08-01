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
 * Run every specialist in a fixed order, without any LLM orchestration.
 *
 * This is the fallback used when no model is configured, and it doubles as a
 * reference implementation: it exercises exactly the same business logic the
 * agents call through their tools, so the two paths can be compared directly.
 */
export async function runDeterministicPipeline(marketId: string): Promise<AnalysisOutputs> {
  const [market, orderbook] = await Promise.all([
    jupiter.getMarket(marketId),
    jupiter.getOrderbook(marketId),
  ]);

  const snapshot = buildMarketSnapshot(market, orderbook);
  const features = deriveFeatures(snapshot);

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
