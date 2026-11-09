import ratesData from '@/data/fertilizer-rates.json';

export type SoilType = 'poor' | 'medium' | 'fertile';

export interface FertilizerRateRow {
  crop: string;
  soil: SoilType;
  product: string;
  kgPerAcre: number;
  source: string;
}

export interface FertilizerCalculationItem {
  product: string;
  kgPerAcre: number;
  totalKg: number;
  bags50Kg: number;
  source: string;
}

export interface FertilizerCalculationResult {
  crop: string;
  soil: SoilType;
  areaAcres: number;
  items: FertilizerCalculationItem[];
  source: string;
}

/**
 * Deterministic Fertilizer Calculator (Section 9.5 of SPEC.md)
 * total = rate per acre x area in acres, for each product, looked up by crop and soil.
 * Always shows the verified source note.
 */
export function calculateFertilizer(
  crop: string,
  soil: SoilType,
  areaAcres: number
): FertilizerCalculationResult {
  const safeArea = Number.isFinite(areaAcres) && areaAcres > 0 ? areaAcres : 0;
  const rows = (ratesData as FertilizerRateRow[]).filter(
    (r) => r.crop === crop && r.soil === soil
  );

  const items: FertilizerCalculationItem[] = rows.map((row) => {
    const totalKg = Math.round(row.kgPerAcre * safeArea * 100) / 100;
    const bags50Kg = Math.round((totalKg / 50) * 10) / 10;
    return {
      product: row.product,
      kgPerAcre: row.kgPerAcre,
      totalKg,
      bags50Kg,
      source: row.source,
    };
  });

  return {
    crop,
    soil,
    areaAcres: safeArea,
    items,
    source: rows[0]?.source || 'Provincial Agriculture Department & PARC Soil Fertility Guide',
  };
}
