import type { AgentName } from '../schemas/index.js';
import { stanceWasCorrect } from './metrics.js';
import { decisionKey } from './stances.js';
import type { GradedStance, HeadToHead } from './types.js';

/**
 * Who wins when specialists disagree.
 *
 * This exists because of Phase 4's headline finding. `aggregateSignals` prices
 * disagreement in as `confidence = meanConfidence × agreement`, so two equally
 * confident opposing agents annihilate each other and the swarm holds. That
 * rule assumes the two are equally worth listening to.
 *
 * If it turns out that one of them is right two thirds of the time whenever
 * they clash, the symmetric penalty is throwing away a real edge — and that is
 * a concrete, testable instruction to hand Phase 6. If they split evenly, the
 * penalty is correct and the swarm should genuinely stay out.
 */

/** Stances at one decision point, keyed by agent. */
type StancesAtMoment = Map<AgentName, GradedStance>;

/** Group stances so the agents present at the same moment can be compared. */
function groupByMoment(stances: GradedStance[]): StancesAtMoment[] {
  const moments = new Map<string, StancesAtMoment>();

  for (const stance of stances) {
    const key = decisionKey(stance);
    let moment = moments.get(key);
    if (!moment) {
      moment = new Map();
      moments.set(key, moment);
    }
    // Two stances from the same agent at the same instant should not happen;
    // if they do, the first is kept so the count stays a count of moments.
    if (!moment.has(stance.agent)) {
      moment.set(stance.agent, stance);
    }
  }

  return [...moments.values()];
}

/** Every unordered pair of agents that ever appeared together, in a stable order. */
function agentPairs(moments: StancesAtMoment[]): Array<[AgentName, AgentName]> {
  const seen = new Set<AgentName>();
  for (const moment of moments) {
    for (const agent of moment.keys()) {
      seen.add(agent);
    }
  }

  const agents = [...seen].sort();
  const pairs: Array<[AgentName, AgentName]> = [];
  for (let i = 0; i < agents.length; i += 1) {
    for (let j = i + 1; j < agents.length; j += 1) {
      const first = agents[i];
      const second = agents[j];
      if (first && second) {
        pairs.push([first, second]);
      }
    }
  }
  return pairs;
}

/**
 * Compare one pair across every moment they both took a side.
 *
 * Neutral stances are skipped entirely. An agent that abstained neither agreed
 * nor disagreed, and counting abstentions as agreement would make a silent
 * agent look like a reliable ally.
 */
function comparePair(
  moments: StancesAtMoment[],
  agentA: AgentName,
  agentB: AgentName,
): HeadToHead {
  let comparisons = 0;
  let agreements = 0;
  let disagreements = 0;
  let agentAWins = 0;
  let agentBWins = 0;
  let agreedCorrect = 0;

  for (const moment of moments) {
    const a = moment.get(agentA);
    const b = moment.get(agentB);
    if (!a || !b || a.stance === 'neutral' || b.stance === 'neutral') {
      continue;
    }

    comparisons += 1;
    const aCorrect = stanceWasCorrect(a);

    if (a.stance === b.stance) {
      agreements += 1;
      if (aCorrect) {
        agreedCorrect += 1;
      }
      continue;
    }

    // Opposite sides of a binary market: exactly one of them is right.
    disagreements += 1;
    if (aCorrect) {
      agentAWins += 1;
    } else {
      agentBWins += 1;
    }
  }

  return {
    agentA,
    agentB,
    comparisons,
    agreements,
    disagreements,
    agentAWins,
    agentBWins,
    agreementAccuracy: agreements > 0 ? agreedCorrect / agreements : null,
  };
}

/**
 * Head-to-head records for every pair of specialists that overlapped.
 *
 * Pairs that never took a side at the same moment are dropped: a row of zeroes
 * says nothing except that the two agents never met.
 */
export function buildHeadToHead(stances: GradedStance[]): HeadToHead[] {
  const moments = groupByMoment(stances);

  return agentPairs(moments)
    .map(([agentA, agentB]) => comparePair(moments, agentA, agentB))
    .filter((pair) => pair.comparisons > 0)
    .sort((left, right) => right.disagreements - left.disagreements);
}
