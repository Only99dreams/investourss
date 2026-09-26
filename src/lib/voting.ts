/**
 * Community voting: paid voting power, cast votes, and leaderboards.
 *
 * All authority lives in the database. `cast_post_vote` is the only way a vote
 * can be written and it re-checks payment, self-voting and the per-stage
 * allowance atomically, so nothing here is trusted - this module reads state
 * and renders the reason the database gave when it refuses.
 *
 * The tier table mirrors `voting_power_tiers` for display only (so the upgrade
 * prompt can name the tiers before anyone has a stage open). The database is
 * the source of truth for what a given user may actually cast.
 */

import { supabase } from "@/integrations/supabase/client";

export interface VotingPower {
  stage_id: string;
  stage_name: string;
  stage_number: number;
  source: "subscription" | "credit_pack";
  source_label: string;
  votes_per_stage: number;
  votes_used: number;
  votes_remaining: number;
}

export interface CastResult {
  ok: boolean;
  message: string;
  votes_remaining: number;
  post_votes_count: number;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  total_votes: number;
  posts_backed: number;
}

/** Kept in step with `voting_power_tiers`; used for the upgrade prompt. */
export const VOTING_TIERS: {
  source: "subscription" | "credit_pack";
  plan_key: string;
  label: string;
  votes_per_stage: number;
}[] = [
  { source: "subscription", plan_key: "monthly", label: "Monthly", votes_per_stage: 1 },
  { source: "subscription", plan_key: "quarterly", label: "Quarterly", votes_per_stage: 2 },
  { source: "subscription", plan_key: "biennial", label: "Bi-Annual", votes_per_stage: 3 },
  { source: "subscription", plan_key: "annual", label: "Annual", votes_per_stage: 4 },
  { source: "credit_pack", plan_key: "starter", label: "Starter", votes_per_stage: 1 },
  { source: "credit_pack", plan_key: "standard", label: "Standard", votes_per_stage: 2 },
  { source: "credit_pack", plan_key: "annual", label: "Annual Pack", votes_per_stage: 3 },
];

export const formatVotes = (n: number) =>
  new Intl.NumberFormat("en-NG", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);

/**
 * The signed-in user's voting power, or null when they cannot vote.
 *
 * Null covers three different situations that the UI needs to tell apart, so
 * the stage is fetched alongside: no power at all (free user), and power that
 * is merely unavailable because no stage is open. A free user with an open stage
 * gets no row, so this returns null and `stage` is the only way to tell whether
 * voting itself is open.
 */
/** Every RPC here returns a row set; take the first row or nothing. */
function firstRow<T>(data: T[] | T | null | undefined): T | null {
  if (data == null) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function fetchVotingPower(): Promise<VotingPower | null> {
  const { data, error } = await supabase.rpc("get_voting_power");
  if (error) {
    // The migration has not been applied yet. Callers treat this as "cannot
    // vote" and the UI hides the button rather than offering a broken one.
    console.warn("Voting unavailable:", error.message);
    return null;
  }
  return firstRow<VotingPower>(data);
}

export async function fetchVotingStage(): Promise<{ name: string; number: number } | null> {
  try {
    const { data, error } = await supabase.rpc("get_current_voting_stage");
    if (error) return null;
    const row = firstRow<{ stage_name: string; stage_number: number }>(data);
    return row ? { name: row.stage_name, number: row.stage_number } : null;
  } catch {
    return null;
  }
}

/** Cast, change or withdraw this user's vote on one post. */
export async function castVote(postId: string, amount: number): Promise<CastResult> {
  const { data, error } = await supabase.rpc("cast_post_vote", {
    p_post_id: postId,
    p_amount: amount,
  });
  if (error) {
    return { ok: false, message: error.message, votes_remaining: 0, post_votes_count: 0 };
  }
  return (
    firstRow<CastResult>(data) ?? {
      ok: false,
      message: "Vote could not be recorded.",
      votes_remaining: 0,
      post_votes_count: 0,
    }
  );
}

/** What the signed-in user has already put on each of these posts. */
export async function fetchMyVotes(postIds: string[]): Promise<Record<string, number>> {
  if (postIds.length === 0) return {};
  try {
    const { data, error } = await supabase.rpc("get_my_votes", { p_post_ids: postIds });
    if (error) return {};
    const rows = (data ?? []) as { post_id: string; amount: number }[];
    return Object.fromEntries(rows.map((r) => [r.post_id, r.amount]));
  } catch {
    return {};
  }
}

/** Top voters in one category, or across all of them when category is null. */
export async function fetchLeaderboard(
  category: string | null,
  limit = 20,
): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("get_category_leaderboard", {
    p_category: category,
    p_limit: limit,
  });
  if (error) {
    console.warn("Leaderboard unavailable:", error.message);
    return [];
  }
  return (data ?? []) as LeaderboardEntry[];
}

/** Categories that have at least one vote, so empty leaderboards stay hidden. */
export async function fetchVotedCategories(): Promise<{ category: string; total_votes: number }[]> {
  try {
    const { data, error } = await supabase.rpc("get_voted_categories");
    if (error) return [];
    return (data ?? []) as { category: string; total_votes: number }[];
  } catch {
    return [];
  }
}
