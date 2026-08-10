import type { AgentName } from '../schemas/index.js';
import { stanceWasProfitable } from './metrics.js';
import { decisionKey } from './stances.js';
import type { GradedStance, HeadToHead } from './types.js';

/**
 * Who wins when specialists disagree — by intramarket profitability.
 */

type StancesAtMoment = Map<AgentName, GradedStance>;

function groupByMoment(stances: GradedStance[]): StancesAtMoment[] {
  const moments = new Map<string, StancesAtMoment>();

  for (const stance of stances) {
    const key = decisionKey(stance);
    let moment = moments.get(key);
    if (!moment) {
      moment = new Map();
      moments.set(key, moment);
    }
    if (!moment.has(stance.agent)) {
      moment.set(stance.agent, stance);
    }
  }

  return [...moments.values()];
}

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

    const aWin = stanceWasProfitable(a);
    const bWin = stanceWasProfitable(b);
    if (aWin === null && bWin === null) {
      continue;
    }

    comparisons += 1;

    if (a.stance === b.stance) {
      agreements += 1;
      if (aWin === true) {
        agreedCorrect += 1;
      }
      continue;
    }

    disagreements += 1;
    if (aWin === true && bWin !== true) {
      agentAWins += 1;
    } else if (bWin === true && aWin !== true) {
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

export function buildHeadToHead(stances: GradedStance[]): HeadToHead[] {
  const moments = groupByMoment(stances);

  return agentPairs(moments)
    .map(([agentA, agentB]) => comparePair(moments, agentA, agentB))
    .filter((pair) => pair.comparisons > 0)
    .sort((left, right) => right.disagreements - left.disagreements);
}
