export type AmbassadorTier = 'Star' | 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface AmbassadorTierDef {
  readonly name: AmbassadorTier;
  readonly label: string;
  readonly targetBusinesses: number;
  readonly targetIndividuals: number;
  readonly threshold: number;
  readonly incomeBusinesses: number;
  readonly incomeIndividuals: number;
  readonly totalMonthlyIncome: number;
  readonly dailyTarget: string;
  readonly quarterlyReward: string;
  readonly starIcon: string;
}

export const AMBASSADOR_TIERS: AmbassadorTierDef[] = [
  {
    name: 'Star',
    label: '⭐ Star',
    targetBusinesses: 90,
    targetIndividuals: 180,
    threshold: 360,
    incomeBusinesses: 121500,
    incomeIndividuals: 91800,
    totalMonthlyIncome: 213300,
    dailyTarget: '1 Business + 2 Individuals / day',
    quarterlyReward: 'Laptop + Branded Wears',
    starIcon: '⭐',
  },
  {
    name: 'Bronze',
    label: '🥉 Bronze',
    targetBusinesses: 180,
    targetIndividuals: 360,
    threshold: 720,
    incomeBusinesses: 243000,
    incomeIndividuals: 183600,
    totalMonthlyIncome: 426600,
    dailyTarget: '2 Businesses + 4 Individuals / day',
    quarterlyReward: 'iPhone + Branded Wears',
    starIcon: '🥉',
  },
  {
    name: 'Silver',
    label: '🥈 Silver',
    targetBusinesses: 270,
    targetIndividuals: 540,
    threshold: 1080,
    incomeBusinesses: 364500,
    incomeIndividuals: 275400,
    totalMonthlyIncome: 639900,
    dailyTarget: '3 Businesses + 6 Individuals / day',
    quarterlyReward: '₦500,000 Growth Grant + Branded Wears',
    starIcon: '🥈',
  },
  {
    name: 'Gold',
    label: '🥇 Gold',
    targetBusinesses: 360,
    targetIndividuals: 720,
    threshold: 1440,
    incomeBusinesses: 486000,
    incomeIndividuals: 367200,
    totalMonthlyIncome: 853200,
    dailyTarget: '4 Businesses + 8 Individuals / day',
    quarterlyReward: '₦1,000,000 Growth Grant + Branded Wears',
    starIcon: '🥇',
  },
  {
    name: 'Platinum',
    label: '💎 Platinum',
    targetBusinesses: 450,
    targetIndividuals: 900,
    threshold: 1800,
    incomeBusinesses: 607500,
    incomeIndividuals: 459000,
    totalMonthlyIncome: 1066500,
    dailyTarget: '5 Businesses + 10 Individuals / day',
    quarterlyReward: '₦1,500,000 Growth Grant + Branded Wears',
    starIcon: '💎',
  },
];

const FIRST_TIER = AMBASSADOR_TIERS[0];

export const combinedScore = (businesses: number, individuals: number): number =>
  businesses * 2 + individuals;

export const computeCurrentTier = (
  businesses: number,
  individuals: number,
): AmbassadorTierDef => {
  const score = combinedScore(businesses, individuals);
  for (let i = AMBASSADOR_TIERS.length - 1; i >= 0; i -= 1) {
    if (score >= AMBASSADOR_TIERS[i].threshold) {
      return AMBASSADOR_TIERS[i];
    }
  }
  return FIRST_TIER;
};

export interface TierProgress {
  currentTier: AmbassadorTierDef;
  currentScore: number;
  nextTier: AmbassadorTierDef | null;
  progress: number;
  remaining: number;
  nextThreshold: number | null;
}

export const tierProgress = (
  businesses: number,
  individuals: number,
): TierProgress => {
  const score = combinedScore(businesses, individuals);
  const currentTier = computeCurrentTier(businesses, individuals);
  const currentIndex = AMBASSADOR_TIERS.indexOf(currentTier);
  const nextTier = AMBASSADOR_TIERS[currentIndex + 1] ?? null;
  const nextThreshold = nextTier ? nextTier.threshold : null;

  if (!nextTier || !nextThreshold) {
    return {
      currentTier,
      currentScore: score,
      nextTier: null,
      progress: 100,
      remaining: 0,
      nextThreshold: null,
    };
  }

  const segmentSize = nextThreshold - currentTier.threshold;
  const progress = segmentSize > 0 ? ((score - currentTier.threshold) / segmentSize) * 100 : 0;
  return {
    currentTier,
    currentScore: score,
    nextTier,
    progress: Math.max(0, Math.min(100, progress)),
    remaining: Math.max(0, nextThreshold - score),
    nextThreshold,
  };
};

export const formatNaira = (amount: number): string =>
  `₦${Math.round(amount).toLocaleString()}`;