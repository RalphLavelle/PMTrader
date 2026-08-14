import { createChatModel } from '../llm/index.js';
import { config } from '../config.js';
import { analysisMemory } from '../memory/index.js';
import type { AnalysisMemoryStore } from '../memory/index.js';
import type { SwarmAnalysisResult } from '../schemas/index.js';
import {
  ensureSpecialistSignals,
  fetchMarketContext,
  finaliseAnalysis,
  runDeterministicPipeline,
  type AnalysisOutputs,
} from './pipeline.js';
import { buildAnalysisRecord } from './record.js';
import { getTradingSwarm } from './swarm.js';
import type { SwarmAnalysisStateType } from './state.js';
import { isLlmBackingOff, noteLlmFailure } from '../llm/quota.js';

/** Options accepted when starting an analysis. */
export interface RunSwarmAnalysisOptions {
  marketId: string;
  /** Force the deterministic path even when a model is configured. */
  deterministic?: boolean;
  /** Override the memory store, primarily for tests. */
  store?: AnalysisMemoryStore;
}

/**
 * Run the trading swarm over a single market and persist the result.
 *
 * Two execution paths share one contract:
 *
 * - **Swarm** — agents hand off to each other under LLM control. Used whenever a
 *   model is configured.
 * - **Deterministic** — the same business logic executed in a fixed order. Used
 *   when no model is available, when a quota backoff is active (HTTP 429 /
 *   session usage limit), and on demand for comparison.
 *
 * Both finish by writing an `AnalysisRecord` to the memory store, so history
 * accumulates regardless of which path ran.
 */
export async function runSwarmAnalysis(
  options: RunSwarmAnalysisOptions,
): Promise<SwarmAnalysisResult> {
  const { marketId, deterministic = false } = options;
  const store = options.store ?? analysisMemory;
  // Quota backoff (HTTP 429 / session usage limit) uses the same no-LLM path
  // as an unconfigured model, so the rest of a watchlist batch does not spam.
  const skipLlm = deterministic || isLlmBackingOff();
  const model = skipLlm ? null : createChatModel();

  let mode: 'swarm' | 'deterministic' = model ? 'swarm' : 'deterministic';
  let outputs: AnalysisOutputs;

  try {
    outputs = model
      ? await runViaSwarm(marketId, model)
      : await runDeterministicPipeline(marketId);
  } catch (error) {
    if (model && noteLlmFailure(error)) {
      mode = 'deterministic';
      outputs = await runDeterministicPipeline(marketId);
    } else {
      throw error;
    }
  }

  const result: SwarmAnalysisResult = {
    record: buildAnalysisRecord({
      marketId,
      signals: outputs.signals,
      riskAssessment: outputs.riskAssessment,
      recommendation: outputs.recommendation,
      mode,
    }),
    snapshot: outputs.snapshot,
    features: outputs.features,
  };

  await store.save(result);

  return result;
}

/**
 * Execute the LLM-driven swarm and normalise its final state.
 *
 * The model chooses which agents run, so the result is validated rather than
 * trusted: missing market data is a hard error, and a missing recommendation is
 * repaired by applying the Risk Manager's rules directly.
 */
async function runViaSwarm(
  marketId: string,
  model: NonNullable<ReturnType<typeof createChatModel>>,
): Promise<AnalysisOutputs> {
  // Fetch market data up front so analysis succeeds even when the model skips
  // tool calls — a common limitation with Ollama and other local LLMs.
  const { snapshot, features, context } = await fetchMarketContext(marketId);
  const swarm = getTradingSwarm(model);

  const finalState = (await swarm.invoke(
    {
      marketId,
      snapshot,
      features,
      marketContext: context,
      messages: [
        {
          role: 'user',
          content:
            `Analyse prediction market ${marketId}. Prepare the data, gather trend, ` +
            'mean-reversion and semantic views, then finish with a risk-checked recommendation.',
        },
      ],
    },
    { recursionLimit: config.swarmRecursionLimit },
  )) as SwarmAnalysisStateType;

  if (!finalState.snapshot || !finalState.features) {
    const detail = finalState.errors.join(' ') || 'The Market Analyst produced no snapshot.';
    throw new Error(`Swarm could not prepare market data for ${marketId}. ${detail}`);
  }

  const marketContext = finalState.marketContext ?? context;

  const signals = await ensureSpecialistSignals(
    finalState.snapshot,
    finalState.features,
    finalState.signals,
    marketContext,
  );

  const filledMissingSignals = signals.length > finalState.signals.length;
  if (filledMissingSignals) {
    console.warn(
      `[swarm] ${marketId}: model skipped specialist tools — filled ${signals.length - finalState.signals.length} signal(s) deterministically.`,
    );
  }

  // Guard against the model ending its turn without calling `assess_risk`, or
  // calling it before every specialist had contributed.
  const needsRiskReview =
    filledMissingSignals || !finalState.recommendation || !finalState.riskAssessment;
  const finalised = needsRiskReview
    ? finaliseAnalysis(
        marketId,
        finalState.snapshot,
        finalState.features,
        signals,
        marketContext,
      )
    : { riskAssessment: finalState.riskAssessment!, recommendation: finalState.recommendation! };

  if (needsRiskReview) {
    console.warn(
      `[swarm] ${marketId}: agents finished without a risk assessment — applied risk rules directly.`,
    );
  }

  return {
    snapshot: finalState.snapshot,
    features: finalState.features,
    context: marketContext,
    signals,
    riskAssessment: finalised.riskAssessment,
    recommendation: finalised.recommendation,
  };
}
