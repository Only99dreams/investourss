export interface SubscriberLike {
  has_active_subscription: boolean;
  subscription_expires_at?: string | null;
}

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
