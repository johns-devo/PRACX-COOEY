export type FeeRoundingRule = "cent" | "dollar" | "five" | "ten";

const ROUNDING_UNITS: Record<FeeRoundingRule, number> = { cent: 0.01, dollar: 1, five: 5, ten: 10 };

export function calculatePracticeCharge(medicareRate: number, multiplierPercent: number, roundingRule: FeeRoundingRule) {
  if (!Number.isFinite(medicareRate) || medicareRate < 0 || !Number.isFinite(multiplierPercent) || multiplierPercent <= 0) {
    throw new Error("A non-negative Medicare rate and positive multiplier are required.");
  }
  const unit = ROUNDING_UNITS[roundingRule];
  if (!unit) throw new Error("Unsupported practice charge rounding rule.");
  const amount = medicareRate * multiplierPercent / 100;
  return (Math.round((amount + Number.EPSILON) / unit) * unit).toFixed(2);
}
