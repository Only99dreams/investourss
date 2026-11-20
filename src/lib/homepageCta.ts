import { supabase } from "@/integrations/supabase/client";

export const HOMEPAGE_CTA_KEYS = {
  challenge: "homepage_creativity_challenge_button_visible",
  partner: "homepage_enterprise_partner_button_visible",
} as const;

export interface HomepageCtaVisibility {
  challenge: boolean;
  partner: boolean;
}

// Preserve the current homepage until an admin changes the settings:
// the challenge button is shown and the partner button is hidden.
export const DEFAULT_HOMEPAGE_CTA_VISIBILITY: HomepageCtaVisibility = {
  challenge: true,
  partner: false,
};

const parseBooleanSetting = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }

  // system_settings values are JSONB. Support object shapes too so the
  // toggles keep working if a setting was edited as JSON in Supabase.
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const field of ["visible", "enabled", "is_active"]) {
      if (field in record) return parseBooleanSetting(record[field], fallback);
    }
  }

  return fallback;
};

export const fetchHomepageCtaVisibility = async (): Promise<HomepageCtaVisibility> => {
  const { data, error } = await supabase
    .from("system_settings")
    .select("key,value")
    .in("key", Object.values(HOMEPAGE_CTA_KEYS));

  if (error) throw error;

  const values = new Map((data ?? []).map((row) => [row.key, row.value]));

  return {
    challenge: parseBooleanSetting(
      values.get(HOMEPAGE_CTA_KEYS.challenge),
      DEFAULT_HOMEPAGE_CTA_VISIBILITY.challenge,
    ),
    partner: parseBooleanSetting(
      values.get(HOMEPAGE_CTA_KEYS.partner),
      DEFAULT_HOMEPAGE_CTA_VISIBILITY.partner,
    ),
  };
};

export const saveHomepageCtaVisibility = async (
  visibility: HomepageCtaVisibility,
): Promise<void> => {
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from("system_settings").upsert(
    [
      {
        key: HOMEPAGE_CTA_KEYS.challenge,
        value: visibility.challenge,
        updated_at: updatedAt,
      },
      {
        key: HOMEPAGE_CTA_KEYS.partner,
        value: visibility.partner,
        updated_at: updatedAt,
      },
    ],
    { onConflict: "key" },
  );

  if (error) throw error;
};
