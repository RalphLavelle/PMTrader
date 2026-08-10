import {
  aggregateSignals,
  assessRisk,
  buildMarketSnapshot,
  buildRecommendation,
  evaluateMeanReversion,
  evaluateSemantic,
  evaluateTrend,
} from '../agents/index.js';
import { AGENT_NAMES } from '../agents/names.js';
import {
  buildMarketContextAt,
  loadMarketOrderbooks,
  loadMarketSnapshots,
  loadTrades,
  type MarketContext,
} from '../features/index.js';
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
  /** Canonical as-of-T context (history + live tip). */
  context: MarketContext;
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
  context?: MarketContext,
): { riskAssessment: RiskAssessment; recommendation: SwarmRecommendation } {
  const now = context ? new Date(context.at) : new Date();
  const proposal = aggregateSignals(marketId, signals);
  const riskAssessment = assessRisk(
    proposal,
    snapshot,
    features,
    configuredRiskLimits,
    now,
    context,
  );
  const recommendation = buildRecommendation(proposal, riskAssessment, now);

  return { riskAssessment, recommendation };
}

/**
 * Fetch Jupiter market data, join collector history as-of now, and build the
 * canonical MarketContext agents receive.
 *
 * Shared by the deterministic pipeline and the LLM swarm. Pre-fetching here
 * keeps analysis working even when the model skips tool calls (common with
 * local Ollama models that do not reliably invoke functions).
 */
export async function fetchMarketContext(marketId: string): Promise<{
  snapshot: MarketSnapshot;
  features: DerivedFeatures;
  context: MarketContext;
}> {
  const [market, orderbook] = await Promise.all([
    jupiter.getMarket(marketId),
    jupiter.getOrderbook(marketId),
  ]);

  const capturedAt = new Date();
  const snapshot = buildMarketSnapshot(market, orderbook, capturedAt);
  const history = await loadHistoryAsOf(marketId, capturedAt);

  const context = buildMarketContextAt({
    at: capturedAt,
    snapshots: history.snapshots,
    orderbooks: history.orderbooks,
    trades: history.trades,
    liveSnapshot: snapshot,
    openTime: market.openTime ?? null,
    rulesPrimary: market.rulesPrimary ?? null,
    rulesSecondary: market.rulesSecondary ?? null,
  });

  return {
    snapshot: context.snapshot,
    features: context.features,
    context,
  };
}

/**
 * Load collector history for a market, best-effort.
 *
 * If Mongo is unavailable the live tip alone still forms a valid context —
 * trajectory fields simply stay null until history exists.
 */
async function loadHistoryAsOf(
  marketId: string,
  at: Date,
): Promise<{
  snapshots: Awaited<ReturnType<typeof loadMarketSnapshots>>;
  orderbooks: Awaited<ReturnType<typeof loadMarketOrderbooks>>;
  trades: Awaited<ReturnType<typeof loadTrades>>;
}> {
  const atMs = at.getTime();
  try {
    const [snapshots, orderbooks, trades] = await Promise.all([
      loadMarketSnapshots(marketId, 500),
      loadMarketOrderbooks(marketId, 500),
      loadTrades({ marketId, limit: 500, ascending: true }),
    ]);
    return {
      snapshots: snapshots.filter((row) => row.capturedAt.getTime() <= atMs),
      orderbooks: orderbooks.filter((row) => row.capturedAt.getTime() <= atMs),
      trades: trades.filter((row) => row.timestamp.getTime() <= atMs),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.warn(
      `[swarm] Could not load collector history for ${marketId} (${message}) — using live tip only`,
    );
    return { snapshots: [], orderbooks: [], trades: [] };
  }
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
  context?: MarketContext,
): Promise<AgentSignal[]> {
  const byAgent = new Map(signals.map((signal) => [signal.agent, signal]));
  const now = context ? new Date(context.at) : new Date();

  if (!byAgent.has(AGENT_NAMES.trend)) {
    byAgent.set(AGENT_NAMES.trend, evaluateTrend(snapshot, features, now, context));
  }

  if (!byAgent.has(AGENT_NAMES.meanReversion)) {
    byAgent.set(
      AGENT_NAMES.meanReversion,
      evaluateMeanReversion(snapshot, features, now, context),
    );
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
  const { snapshot, features, context } = await fetchMarketContext(marketId);
  const now = new Date(context.at);

  // The semantic evaluator degrades to a neutral signal without a model, so it
  // is safe to call here even though this is the no-LLM path.
  const signals: AgentSignal[] = [
    evaluateTrend(snapshot, features, now, context),
    evaluateMeanReversion(snapshot, features, now, context),
    await evaluateSemantic(snapshot),
  ];

  const { riskAssessment, recommendation } = finaliseAnalysis(
    marketId,
    snapshot,
    features,
    signals,
    context,
  );

  return { snapshot, features, context, signals, riskAssessment, recommendation };
}
