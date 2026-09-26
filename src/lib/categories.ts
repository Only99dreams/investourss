/**
 * Post categories, shared by every surface that can create or filter a post.
 *
 * `posts.category` began life as a `post_category` enum holding seven fixed
 * values, and was later converted to TEXT so admins could define their own.
 * Both the community page and the home page section create posts, and they must
 * agree on what is storable - a composer that offers a name the column will
 * reject is what pushed posts into a phantom bucket nothing could filter.
 */

import { supabase } from "@/integrations/supabase/client";

export interface Category {
  id: string;
  name: string;
  label: string;
  icon: string;
  color: string;
}

/** Sentinel used by the filter row; never a real stored value. */
export const ALL_CATEGORY_NAME = "all";

/**
 * The value the enum always accepts, used as the last-resort retry so a post is
 * never lost because of a category problem.
 */
export const ENUM_SAFE_CATEGORY = "finance";

const NEUTRAL = "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100";

export const allPostsCategory: Category = {
  id: ALL_CATEGORY_NAME,
  name: ALL_CATEGORY_NAME,
  label: "All Posts",
  icon: "MessageSquare",
  color: NEUTRAL,
};

export const DEFAULT_CATEGORIES: Category[] = [
  allPostsCategory,
  { id: "funding_grants", name: "funding_grants", label: "Funding & Grants", icon: "Banknote", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" },
  { id: "jobs_gigs", name: "jobs_gigs", label: "Jobs & Gigs", icon: "Briefcase", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100" },
  { id: "partnerships", name: "partnerships", label: "Partnerships", icon: "Handshake", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100" },
  { id: "accelerators", name: "accelerators", label: "Accelerators & Competitions", icon: "Rocket", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100" },
  { id: "scholarships", name: "scholarships", label: "Scholarships & Fellowships", icon: "GraduationCap", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100" },
  { id: "training_events", name: "training_events", label: "Training & Events", icon: "Calendar", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100" },
  { id: "announcements", name: "announcements", label: "Community Announcements", icon: "Megaphone", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100" },
  { id: "general", name: "general", label: "General", icon: "Tag", color: NEUTRAL },
];

/**
 * The values the original `post_category` enum accepts. While `posts.category`
 * is still that enum, these seven are the only storable names, so the composer
 * and the filter row fall back to them.
 */
export const LEGACY_ENUM_CATEGORIES: Category[] = [
  allPostsCategory,
  { id: "finance", name: "finance", label: "Finance", icon: "Banknote", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" },
  { id: "education", name: "education", label: "Education", icon: "GraduationCap", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100" },
  { id: "investment", name: "investment", label: "Investment", icon: "TrendingUp", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100" },
  { id: "climate", name: "climate", label: "Climate", icon: "Leaf", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
  { id: "announcement", name: "announcement", label: "Announcement", icon: "Megaphone", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100" },
  { id: "advert", name: "advert", label: "Advert", icon: "Tag", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100" },
  { id: "scam_alert", name: "scam_alert", label: "Scam Alert", icon: "AlertTriangle", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100" },
];

interface CategoryRow {
  name: string;
  label: string;
  icon?: string | null;
  color?: string | null;
}

/** Active admin categories, in the order the dashboard set. Never throws. */
export async function loadPostCategories(): Promise<Category[]> {
  try {
    const { data, error } = await supabase
      .from("post_categories")
      .select("*")
      .eq("is_active", true)
      // Admin sets the order from the dashboard; name is a stable tiebreaker
      // for any rows that still share a sort_order.
      .order("sort_order")
      .order("name");

    if (error) throw error;
    if (!data || data.length === 0) return DEFAULT_CATEGORIES;

    return [
      allPostsCategory,
      ...(data as CategoryRow[]).map((c) => ({
        id: c.name,
        name: c.name,
        label: c.label,
        icon: c.icon || "Tag",
        color: c.color || NEUTRAL,
      })),
    ];
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

/**
 * Is `posts.category` still the old `post_category` enum?
 *
 * Filtering on a real admin category name is a cheap, read-only way to ask:
 * Postgres binds the value to the column type before RLS or row filtering, so
 * an enum column rejects 'funding_grants' with 22P02 while a TEXT column simply
 * returns no rows. That makes the check self-verifying rather than dependent on
 * someone posting again after the migration.
 */
export async function isCategoryColumnStillEnum(categories: Category[]): Promise<boolean> {
  try {
    // Deliberately probes the admin list, not the legacy fallback: a legacy
    // enum value would be accepted by both column types and prove nothing.
    const probe = categories.find((c) => c.name !== ALL_CATEGORY_NAME)?.name ?? "funding_grants";
    const { error } = await supabase.from("posts").select("id").eq("category", probe).limit(1);

    return error?.code === "22P02" || error?.code === "23514";
  } catch {
    // Probe unavailable (offline, missing table) - don't nag.
    return false;
  }
}

/** 22P02 = invalid_text_representation, 23514 = check_violation. */
export function isCategoryValueError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "22P02" || error?.code === "23514";
}

/**
 * The category a post will actually be filed under.
 *
 * An admin can deactivate the category a composer last used, which would
 * silently file the post under something absent from the filter list. The
 * fallback is the neutral default rather than the first row: on the live
 * instance that row is "Idea Competition", which would attach the competition
 * pitch to an unrelated post.
 */
export function pickStorableCategory(desired: string, categories: Category[]): string {
  const names = categories.filter((c) => c.name !== ALL_CATEGORY_NAME).map((c) => c.name);
  return names.includes(desired) ? desired : pickDefaultPostCategory(categories);
}

/**
 * Category names that carry a competition pitch on share. A post landing in one
 * of these advertises the competition whether or not it is an entry, so they
 * are never a sensible default.
 */
const COMPETITION_HINT = /competition|contest|aiwc|award|grant|scholarship/i;

/**
 * The category a composer starts on.
 *
 * "general" is the traditional name for this, but it is admin-defined and
 * frequently absent - the live instance has no `general` row. Falling back to
 * the first category instead would file every post under whichever category
 * happens to sort first, which is currently "Idea Competition", and silently
 * attach the competition pitch to unrelated posts. So prefer a neutral name
 * that exists, and otherwise the first entry that is not competition-shaped.
 */
export function pickDefaultPostCategory(categories: Category[]): string {
  const names = categories.filter((c) => c.name !== ALL_CATEGORY_NAME).map((c) => c.name);
  if (names.length === 0) return ENUM_SAFE_CATEGORY;
  if (names.includes("general")) return "general";
  if (names.includes("announcements")) return "announcements";
  return names.find((n) => !COMPETITION_HINT.test(n)) ?? names[0];
}

/**
 * Keep a composer's remembered category if it is still offered, otherwise move
 * to a sane default. An admin renaming or deactivating a category must not
 * leave the composer pointing at a value it can no longer store.
 */
export function reconcileCategory(desired: string, categories: Category[]): string {
  const names = categories.filter((c) => c.name !== ALL_CATEGORY_NAME).map((c) => c.name);
  return names.includes(desired) ? desired : pickDefaultPostCategory(categories);
}
