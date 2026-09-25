import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { callReferralRpc, captureReferralCode, normalizeReferralCode } from "@/lib/referral";

/**
 * Runs on every navigation. A shared referral link can land on any page
 * (homepage, community post, pricing...) and the visitor may only sign up
 * later, so the ?ref= code is captured and persisted globally instead of
 * only on the signup/dashboard pages. The click counter is bumped once per
 * browser session per code so refreshes don't inflate the stats.
 */
export function ReferralCapture() {
  const { search } = useLocation();
  const counted = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ref = normalizeReferralCode(new URLSearchParams(search).get("ref"));
    if (!ref) return;

    captureReferralCode(ref);

    if (counted.current.has(ref)) return;
    counted.current.add(ref);
    try {
      if (sessionStorage.getItem(`investours_ref_counted_${ref}`)) return;
      sessionStorage.setItem(`investours_ref_counted_${ref}`, "1");
    } catch {
      /* storage unavailable — still count once per mount */
    }
    void (async () => {
      try {
        await callReferralRpc("record_referral_click", { p_code: ref });
      } catch {
        /* analytics only — never block navigation */
      }
    })();
  }, [search]);

  return null;
}

export default ReferralCapture;
