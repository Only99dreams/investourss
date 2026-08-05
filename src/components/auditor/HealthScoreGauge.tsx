import { HEALTH_STATUS_META, type HealthStatus } from "@/lib/auditor";
import { cn } from "@/lib/utils";

interface HealthScoreGaugeProps {
  score: number;
  status?: HealthStatus;
  size?: number;
}

export const HealthScoreGauge = ({ score, status, size = 180 }: HealthScoreGaugeProps) => {
  const resolvedStatus = status ?? (score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 50 ? "needs_attention" : "critical");
  const meta = HEALTH_STATUS_META[resolvedStatus];
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-secondary"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={meta.hex}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold" style={{ color: meta.hex }}>
          {score}
        </span>
        <span className={cn("text-xs font-medium uppercase tracking-wide", meta.color)}>
          {meta.label}
        </span>
      </div>
    </div>
  );
};
