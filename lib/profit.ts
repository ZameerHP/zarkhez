/**
 * Deterministic Profit Calculator (Section 9.5 of SPEC.md)
 * income = yield per acre x price per unit x area.
 * Profit = income minus the sum of costs.
 * The slider scales the price from minus 30 percent to plus 30 percent.
 */

export interface ProfitInputs {
  areaAcres: number;
  yieldPerAcre: number;
  basePricePerUnit: number;
  priceSliderPercent?: number; // -30 to +30
  costsPerAcre: {
    seed?: number;
    fertilizer?: number;
    irrigation?: number;
    spray?: number;
    laborAndHarvest?: number;
  };
}

export interface ProfitResult {
  areaAcres: number;
  effectivePricePerUnit: number;
  grossIncomePerAcre: number;
  totalGrossIncome: number;
  costPerAcre: number;
  totalCost: number;
  profitPerAcre: number;
  totalNetProfit: number;
}

function safeNum(val: number | undefined | null): number {
  if (val === undefined || val === null || !Number.isFinite(val) || val < 0) {
    return 0;
  }
  return val;
}

export function calculateProfit(input: ProfitInputs): ProfitResult {
  const area = safeNum(input.areaAcres);
  const yieldPerAcre = safeNum(input.yieldPerAcre);
  const basePrice = safeNum(input.basePricePerUnit);

  // Clamp slider between -30 and +30
  const rawSlider = Number.isFinite(input.priceSliderPercent)
    ? (input.priceSliderPercent as number)
    : 0;
  const clampedSlider = Math.max(-30, Math.min(30, rawSlider));

  const effectivePricePerUnit = Math.round(basePrice * (1 + clampedSlider / 100) * 100) / 100;

  const costPerAcre =
    safeNum(input.costsPerAcre.seed) +
    safeNum(input.costsPerAcre.fertilizer) +
    safeNum(input.costsPerAcre.irrigation) +
    safeNum(input.costsPerAcre.spray) +
    safeNum(input.costsPerAcre.laborAndHarvest);

  const grossIncomePerAcre = Math.round(yieldPerAcre * effectivePricePerUnit);
  const totalGrossIncome = Math.round(grossIncomePerAcre * area);
  const totalCost = Math.round(costPerAcre * area);
  const profitPerAcre = grossIncomePerAcre - costPerAcre;
  const totalNetProfit = totalGrossIncome - totalCost;

  return {
    areaAcres: area,
    effectivePricePerUnit,
    grossIncomePerAcre,
    totalGrossIncome,
    costPerAcre,
    totalCost,
    profitPerAcre,
    totalNetProfit,
  };
}
