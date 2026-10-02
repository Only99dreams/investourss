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
  stage_category: string | null;
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

/** One row of the leaderboard: a creator ranked by the votes their posts got. */
export interface LeaderboardEntry {
  rank: number;
  /** The post author who received the votes, not the people who cast them. */
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  total_votes: number;
  /** How many of their posts received a vote. */
  posts_count: number;
  /** Their best-scoring post, for linking straight to it. */
  top_post_id: string | null;
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
  { source: "credit_pack", plan_key: "starter", label: "Starter Credit Pack", votes_per_stage: 1 },
  { source: "credit_pack", plan_key: "standard", label: "Standard Credit Pack", votes_per_stage: 2 },
  { source: "credit_pack", plan_key: "annual", label: "Annual Credit Pack", votes_per_stage: 3 },
];

/**
 * The canonical URL for a post: /post/:id
 *
 * One stable, deterministic URL per post, and the only one that carries sharing
 * metadata. /api/share exists solely to redirect old links here.
 *
 * There is deliberately NO cache-busting token. A random parameter made each
 * share a URL no platform had cached, which works around preview caches, but it
 * gives one post an unbounded number of URLs - wrong for canonical correctness,
 * analytics and any CDN. Preview caches are refreshed by sharing a different
 * post, not by mutating the URL.
 */
export function buildShareUrl(postId: string, ref?: string | null): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://investours.app";
  const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  return `${origin}/post/${encodeURIComponent(postId)}${refParam}`;
}

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

export async function fetchVotingPower(category?: string): Promise<VotingPower | null> {
  const { data, error } = await supabase.rpc("get_voting_power", { p_category: category ?? null });
  if (error) {
    // The migration has not been applied yet. Callers treat this as "cannot
    // vote" and the UI hides the button rather than offering a broken one.
    console.warn("Voting unavailable:", error.message);
    return null;
  }
  return firstRow<VotingPower>(data);
}

export async function fetchVotingStage(category?: string): Promise<{ name: string; number: number; category: string | null } | null> {
  try {
    const { data, error } = await supabase.rpc("get_current_voting_stage", { p_category: category ?? null });
    if (error) return null;
    const row = firstRow<{ stage_name: string; stage_number: number; stage_category: string | null }>(data);
    return row ? { name: row.stage_name, number: row.stage_number, category: row.stage_category } : null;
  } catch {
    return null;
  }
}

/** Cast, change or withdraw this user's vote on one post. */
export async function castVote(postId: string, amount: number, category?: string): Promise<CastResult> {
  const { data, error } = await supabase.rpc("cast_post_vote", {
    p_post_id: postId,
    p_amount: amount,
    p_category: category ?? null,
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
export async function fetchMyVotes(postIds: string[], category?: string): Promise<Record<string, number>> {
  if (postIds.length === 0) return {};
  try {
    const { data, error } = await supabase.rpc("get_my_votes", { p_post_ids: postIds, p_category: category ?? null });
    if (error) return {};
    const rows = (data ?? []) as { post_id: string; amount: number }[];
    return Object.fromEntries(rows.map((r) => [r.post_id, r.amount]));
  } catch {
    return {};
  }
}

/** Creators ranked by the votes their posts received, per category. */
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

/** A voting stage that has ended, for the admin closed-votes view. */
export interface ClosedStage {
  stage_id: string;
  stage_name: string;
  stage_number: number;
  stage_category: string | null;
  opens_at: string | null;
  closes_at: string | null;
  total_votes: number;
  total_posts_voted: number;
}

/** Every closed stage, newest first. Empty when the RPC/migration is absent. */
export async function fetchClosedStages(category?: string): Promise<ClosedStage[]> {
  try {
    const { data, error } = await supabase.rpc("get_closed_stages", {
      p_category: category ?? null,
    });
    if (error) {
      console.warn("Closed stages unavailable:", error.message);
      return [];
    }
    return (data ?? []) as ClosedStage[];
  } catch {
    return [];
  }
}

/**
 * Final standings for one closed stage. Admin-only server-side, so a failure
 * (including a non-admin caller) resolves to an empty board rather than an
 * error the UI would have to special-case.
 */
export async function fetchStageLeaderboard(
  stageId: string,
  limit = 50,
): Promise<LeaderboardEntry[]> {
  try {
    const { data, error } = await supabase.rpc("get_stage_leaderboard", {
      p_stage_id: stageId,
      p_limit: limit,
    });
    if (error) {
      console.warn("Stage leaderboard unavailable:", error.message);
      return [];
    }
    return (data ?? []) as LeaderboardEntry[];
  } catch {
    return [];
  }
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
