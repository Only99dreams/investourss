import { useEffect, useState } from "react";
import {
  DEFAULT_HOMEPAGE_CTA_VISIBILITY,
  fetchHomepageCtaVisibility,
} from "@/lib/homepageCta";

export const useHomepageCtaVisibility = () => {
  const [visibility, setVisibility] = useState(DEFAULT_HOMEPAGE_CTA_VISIBILITY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    fetchHomepageCtaVisibility()
      .then((result) => {
        if (mounted) setVisibility(result);
      })
      .catch(() => {
        if (mounted) setVisibility(DEFAULT_HOMEPAGE_CTA_VISIBILITY);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return {
    challengeVisible: visibility.challenge,
    partnerVisible: visibility.partner,
    loading,
  };
};
