/**
 * Types for the Phase 3 outcome labeller (see docs/ResearchDataset.md).
 *
 * The labeller answers one question repeatedly: "has a market we collected data
 * for actually settled yet, and if so, what happened?" Everything here describes
 * either a market worth asking about, or the result of having asked.
 */

/** Why the labeller picked a market to check with Jupiter. */
export type LabelCandidateReason =
  /** The collected close time has passed, so the market should be settling. */
  | 'past-close'
  /** The last collected snapshot showed a status other than "open". */
  | 'status-changed'
  /** Already labelled as closed, but Jupiter has not published a result yet. */
  | 'awaiting-result';

/** One market the labeller wants to re-check with Jupiter. */
export interface LabelCandidate {
  marketId: string;
  title: string;
  /** Status from the most recent stored snapshot. */
  status: string;
  /** Unix seconds, or null when Jupiter never supplied a close time. */
  closeTime: number | null;
  reason: LabelCandidateReason;
}

/** What happened when the labeller asked Jupiter about one market. */
export type LabelAttempt =
  /** A new or changed label was written. */
  | 'labelled'
  /** Settled, but the stored label already said exactly this. */
  | 'unchanged'
  /** Still trading — nothing to label yet. */
  | 'still-open';

/** Summary of applying market labels to stored swarm runs. */
export interface RunLabellingResult {
  /** Runs examined (those still missing an outcome). */
  scanned: number;
  /** Runs that gained an outcome in this pass. */
  labelled: number;
  errors: string[];
}

/** Everything one labelling pass did, surfaced by GET /api/labeller/status. */
export interface LabellerPassResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Markets that looked like they might have settled. */
  candidatesFound: number;
  /** Markets actually queried this pass (limited by the batch size). */
  marketsChecked: number;
  /** Markets whose label was created or updated. */
  marketsLabelled: number;
  /** Stored runs examined for a missing outcome. */
  runsScanned: number;
  /** Stored runs that gained an outcome. */
  runsLabelled: number;
  errors: string[];
}
