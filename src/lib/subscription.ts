export interface SubscriberLike {
  has_active_subscription: boolean;
  subscription_expires_at?: string | null;
}

export const isPremiumTier = (
  profile: { user_tier?: string | null } | null | undefined,
): boolean => profile?.user_tier === "premium" || profile?.user_tier === "exclusive";

export const isActiveSubscriber = (profile: SubscriberLike | null | undefined): boolean => {
  if (!profile) return false;

  const flag = profile.has_active_subscription === true;
  const expires = profile.subscription_expires_at
    ? new Date(profile.subscription_expires_at).getTime()
    : null;
  const notExpired = expires === null || expires > Date.now();
  const futureExpiry = expires !== null && expires > Date.now();

  return (flag && notExpired) || futureExpiry;
};

/** Rank a plan so "at least this plan" can be checked. B2B is its own top tier. */
export const planRank = (plan: string | null | undefined): number => {
  const key = String(plan ?? "").toLowerCase();
  if (key.startsWith("b2b")) return 5;
  if (key === "annual") return 4;
  if (key === "biennial" || key === "bi-annual") return 3;
  if (key === "quarterly") return 2;
  if (key === "monthly") return 1;
  return 0;
};

/**
 * The plan tier a member actually holds right now. A lapsed membership keeps
 * `subscription_type` in the profile, so expiry has to be checked before the
 * plan counts as access.
 */
export const activePlanRank = (
  profile: (SubscriberLike & { subscription_type?: string | null }) | null | undefined,
): number => {
  if (!isActiveSubscriber(profile)) return 0;
  // Active grants created without a recorded type are treated as monthly,
  // matching bookmaker_ensure_subscription_grant.
  return planRank(profile?.subscription_type ?? "monthly");
};

/** True when the member's active plan is at or above the required tier. */
export const meetsPlanTier = (
  profile: (SubscriberLike & { subscription_type?: string | null }) | null | undefined,
  required: string | null | undefined,
): boolean => activePlanRank(profile) >= planRank(required);

export const planLabel = (plan: string | null | undefined): string => {
  const key = String(plan ?? "").toLowerCase();
  if (key.startsWith("b2b")) return "B2B Plan";
  if (key === "annual") return "12-Month Plan";
  if (key === "biennial") return "6-Month Plan";
  if (key === "quarterly") return "3-Month Plan";
  if (key === "monthly") return "1-Month Plan";
  return "Free";
};

/** Tiers offered on education videos and certification courses, in plan order. */
export const PLAN_TIER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "monthly", label: "1-Month Plan" },
  { value: "quarterly", label: "3-Month Plan" },
  { value: "biennial", label: "6-Month Plan" },
  { value: "annual", label: "12-Month Plan" },
  { value: "b2b", label: "B2B Plan" },
] as const;
