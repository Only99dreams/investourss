export interface SubscriberLike {
  has_active_subscription: boolean;
  subscription_expires_at?: string | null;
}

/**
 * True when the profile holds a subscription that has not lapsed. This is the
 * single source of truth for access; there is no separate tier flag anymore.
 */
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

/** Rank a plan so "at least this plan" can be checked. B2B is its own top plan. */
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
 * The plan a member actually holds right now. A lapsed membership keeps
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

/** True when the member's active plan is at or above the required plan. */
export const meetsPlan = (
  profile: (SubscriberLike & { subscription_type?: string | null }) | null | undefined,
  required: string | null | undefined,
): boolean => activePlanRank(profile) >= planRank(required);

export const planLabel = (plan: string | null | undefined): string => {
  const key = String(plan ?? "").toLowerCase();
  if (key.startsWith("b2b")) return "B2B Plan (12 months)";
  if (key === "annual") return "12-Month Plan";
  if (key === "biennial") return "6-Month Plan";
  if (key === "quarterly") return "3-Month Plan";
  if (key === "monthly") return "1-Month Plan";
  return "Free";
};

/** True while the member holds a live B2B subscription (the 30% recurring tier). */
export const isActiveB2BSubscriber = (
  profile: (SubscriberLike & { subscription_type?: string | null }) | null | undefined,
): boolean => {
  if (!isActiveSubscriber(profile)) return false;
  return String(profile?.subscription_type ?? "").toLowerCase().startsWith("b2b");
};

/** Access plans in plan order; "free" carries no subscription. */
export const PLAN_ACCESS_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "monthly", label: "1-Month Plan" },
  { value: "quarterly", label: "3-Month Plan" },
  { value: "biennial", label: "6-Month Plan" },
  { value: "annual", label: "12-Month Plan" },
  { value: "b2b_quarterly", label: "B2B Plan (12 months)" },
  // Legacy code retained for existing B2B rows; it is the same 12-month offer.
  { value: "b2b_annual", label: "B2B Plan (legacy code)" },
] as const;

/** Days of access granted by each plan, mirroring the payment activation RPCs. */
export const PLAN_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  biennial: 180,
  annual: 365,
  b2b_quarterly: 365,
  b2b_annual: 365,
};

export const USER_TYPE_OPTIONS = [
  { value: "individual", label: "Individual" },
  { value: "business", label: "Business" },
  { value: "b2b", label: "B2B Subscriber" },
] as const;

export type UserTypeValue = (typeof USER_TYPE_OPTIONS)[number]["value"];

/** Legacy rows stored group/firm before types were consolidated. */
export const normalizeUserType = (value: string | null | undefined): UserTypeValue => {
  const key = String(value ?? "").toLowerCase();
  if (key === "business" || key === "group" || key === "firm") return "business";
  if (key === "b2b") return "b2b";
  return "individual";
};

export const userTypeLabel = (value: string | null | undefined): string =>
  USER_TYPE_OPTIONS.find((option) => option.value === normalizeUserType(value))?.label ??
  "Individual";
