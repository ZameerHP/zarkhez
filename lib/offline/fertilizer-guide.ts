'use client';

import {
  idbDelete,
  idbGetAll,
  idbPruneOldest,
  idbPut,
  OFFLINE_STORES,
  type FertilizerHistoryRecord,
} from './db';
import { notifyOfflineStateChanged } from './config';
import type { FertilizerCalculationResult, SoilType } from '@/lib/fertilizer';

/**
 * ZARKHEZ Offline Fertilizer Knowledge & History Store
 *
 * Strictly augments existing verified calculator (lib/fertilizer.ts) with:
 * - Crop-stage application schedules (basal, top-dressing timings)
 * - Nutrient function notes (N, P, K, Zn)
 * - Explicit calculation assumptions (50 kg standard bag weight, soil test caveat)
 * - Offline saved recommendation history in IndexedDB
 */

export interface CropFertilizerStageSchedule {
  cropKey: string;
  assumptions: {
    en: string;
    ur: string;
  };
  stages: Array<{
    stageEn: string;
    stageUr: string;
    timingEn: string;
    timingUr: string;
    guidanceEn: string;
    guidanceUr: string;
  }>;
  nutrientNotes: Array<{
    nutrient: string;
    en: string;
    ur: string;
  }>;
}

const CROP_SCHEDULES: Record<string, CropFertilizerStageSchedule> = {
  wheat: {
    cropKey: 'wheat',
    assumptions: {
      en: 'Calculations assume standard 50 kg bags and medium irrigated loam soils unless a local soil test lab report specifies otherwise.',
      ur: 'یہ حساب 50 کلوگرام کی معیاری بوری اور آبپاش درمیانی زمین کے مطابق ہے؛ اگر مٹی کا تجزیہ (سوائل ٹیسٹ) موجود ہو تو اسی کے مطابق مقدار طے کریں۔',
    },
    stages: [
      {
        stageEn: 'Basal / At Sowing',
        stageUr: 'بوائی کے وقت (بنیادی خوراک)',
        timingEn: 'During final land preparation',
        timingUr: 'آخری ہل چلاتے وقت بوائی سے پہلے',
        guidanceEn: 'Apply 100% of DAP and Potash (SOP) plus 1/3rd of Urea (or nitrate) mixed into root zone.',
        guidanceUr: 'پوری ڈی اے پی اور پوٹاش (SOP) اور یوریا کا تیسرا حصہ بوائی کے وقت زمین میں ملائیں۔',
      },
      {
        stageEn: 'First Irrigation (Crown Root Initiation)',
        stageUr: 'پہلا پانی (20 تا 25 دن بعد)',
        timingEn: '20–25 days after sowing',
        timingUr: 'بوائی کے 20 سے 25 دن بعد پہلے پانی کے ساتھ',
        guidanceEn: 'Top-dress 1/3rd of total Urea uniformly before/with first irrigation to boost tillering.',
        guidanceUr: 'شاخیں (ٹلرنگ) بڑھانے کے لیے یوریا کا دوسرا تیسرا حصہ پہلے پانی کے ساتھ دیں۔',
      },
      {
        stageEn: 'Second Irrigation (Booting / Ear Emergence)',
        stageUr: 'دوسرا پانی (گوبھ کی حالت / 45–55 دن)',
        timingEn: '45–55 days after sowing',
        timingUr: 'بوائی کے 45 سے 55 دن بعد',
        guidanceEn: 'Apply remaining 1/3rd Urea; avoid excessive late nitrogen to prevent lodging.',
        guidanceUr: 'باقی تیسرا حصہ یوریا دیں؛ بہت دیر سے زیادہ یوریا ڈالنے سے فصل گرنے کا خدشہ ہوتا ہے۔',
      },
    ],
    nutrientNotes: [
      {
        nutrient: 'N (Urea)',
        en: 'Drives leafy growth, tiller count, and grain protein filling.',
        ur: 'پودے کی بڑھوتری، شاخوں کی تعداد اور دانے کی بھرائی کے لیے ضروری ہے۔',
      },
      {
        nutrient: 'P (DAP)',
        en: 'Essential for strong early roots, uniform emergence, and grain setting.',
        ur: 'ابتدائی جڑوں کی مضبوطی اور دانے بننے کے عمل میں کلیدی کردار ادا کرتی ہے۔',
      },
      {
        nutrient: 'K (SOP)',
        en: 'Improves drought/frost tolerance, stalk strength, and thousand-grain weight.',
        ur: 'پودے میں بیماریوں اور گرمی/سردی کے خلاف قوتِ مدافعت اور دانے کا وزن بڑھاتی ہے۔',
      },
    ],
  },
  rice: {
    cropKey: 'rice',
    assumptions: {
      en: 'Rates assume puddled transplanted rice in 50 kg bag units; Zinc Sulfate (33%) is critical in flooded soils.',
      ur: 'یہ مقدار کدو کے طریقے سے لگائی گئی دھان کی فصل اور 50 کلو کی بوری کے حساب سے ہے؛ کھڑے پانی میں زنک سلفیٹ (%33) نہایت ضروری ہے۔',
    },
    stages: [
      {
        stageEn: 'Puddling / Transplanting',
        stageUr: 'پنیری منتقل کرتے وقت',
        timingEn: '0–7 days around transplanting',
        timingUr: 'پنیری منتقلی کے وقت یا 7 دن کے اندر',
        guidanceEn: 'Apply full DAP and SOP along with 1/3rd Urea at final puddling.',
        guidanceUr: 'پوری ڈی اے پی، پوٹاش اور یوریا کا تیسرا حصہ آخری کدو کے وقت ڈالیں۔',
      },
      {
        stageEn: 'Active Tillering & Zinc Application',
        stageUr: 'جھاڑ بننے کا مرحلہ (15 تا 25 دن)',
        timingEn: '15–25 days after transplanting',
        timingUr: 'پنیری لگانے کے 15 سے 25 دن بعد',
        guidanceEn: 'Apply Zinc Sulfate (33%) and 1/3rd Urea in shallow standing water (do not mix Zinc directly with DAP).',
        guidanceUr: 'کم گہرے پانی میں زنک سلفیٹ (%33) اور یوریا کا دوسرا حصہ دیں (زنک کو ڈی اے پی کے ساتھ ہرگز نہ ملائیں)۔',
      },
      {
        stageEn: 'Panicle Initiation',
        stageUr: 'سٹا نکلنے سے پہلے (40 تا 45 دن)',
        timingEn: '40–45 days after transplanting',
        timingUr: 'منتقلی کے 40 سے 45 دن بعد',
        guidanceEn: 'Apply final 1/3rd Urea when green panicle primordia form.',
        guidanceUr: 'جب پودے میں سٹا بننا شروع ہو تو یوریا کا آخری تیسرا حصہ استعمال کریں۔',
      },
    ],
    nutrientNotes: [
      {
        nutrient: 'Zn (Zinc 33%)',
        en: 'Prevents Khaira/rusty brown spots and stunted rice tillering.',
        ur: 'دھان میں زنک کی کمی (کھائرا / بھورے دھبے) کو روکتی اور جھاڑ بڑھاتی ہے۔',
      },
      {
        nutrient: 'N / P / K',
        en: 'Split nitrogen avoids losses in standing floodwater while P & K build grain weight.',
        ur: 'قسطوں میں نائٹروجن ضائع نہیں ہوتی، اور فاسفورس و پوٹاش دانے بھرنے میں مدد کرتے ہیں۔',
      },
    ],
  },
  cotton: {
    cropKey: 'cotton',
    assumptions: {
      en: 'Assumes medium-textured cotton belts in Punjab/Sindh using 50 kg bags across 3–4 nitrogen splits.',
      ur: 'یہ مقدار پنجاب و سندھ کی کپاس بیلٹ کی درمیانی زمین اور 50 کلو بوری کے مطابق ہے؛ نائٹروجن 3 تا 4 قسطوں میں دیں۔',
    },
    stages: [
      {
        stageEn: 'At Sowing',
        stageUr: 'بوائی کے وقت',
        timingEn: 'Seedbed preparation',
        timingUr: 'زمین کی تیاری کے وقت',
        guidanceEn: 'Apply full DAP and half SOP before ridge/bed formation.',
        guidanceUr: 'بوائی سے پہلے پوری ڈی اے پی اور آدھی پوٹاش زمین میں ملائیں۔',
      },
      {
        stageEn: 'Squaring / Bud Initiation',
        stageUr: 'گڈی لگنے کا مرحلہ (30 تا 35 دن)',
        timingEn: '30–35 days after sowing',
        timingUr: 'بوائی کے 30 سے 35 دن بعد',
        guidanceEn: 'Side-dress 1/3rd Urea after thinning and inter-culturing.',
        guidanceUr: 'چھدرائی کے بعد پہلے یا دوسرے پانی کے ساتھ یوریا کا تیسرا حصہ دیں۔',
      },
      {
        stageEn: 'Flowering & Boll Formation',
        stageUr: 'پھول اور ٹینڈے بننے کا مرحلہ (55–75 دن)',
        timingEn: '55–75 days after sowing',
        timingUr: '55 سے 75 دن کے دوران',
        guidanceEn: 'Apply remaining Urea and second half SOP; excess late Urea attracts sucking pests and delays maturity.',
        guidanceUr: 'باقی یوریا اور آدھی پوٹاش ٹینڈے بننے پر دیں؛ بہت دیر سے زیادہ یوریا رس چوسنے والے کیڑوں کو بڑھاتا ہے۔',
      },
    ],
    nutrientNotes: [
      {
        nutrient: 'K (SOP)',
        en: 'Critical for boll retention, fiber length, and reducing leaf reddening.',
        ur: 'ٹینڈوں کے گرنے کو روکنے، ریشے کی مضبوطی اور پتوں کو سرخ ہونے سے بچانے کے لیے اہم ہے۔',
      },
    ],
  },
  sugarcane: {
    cropKey: 'sugarcane',
    assumptions: {
      en: 'Spring/Autumn sugarcane base doses in 50 kg bags; heavy feeder requiring high K and split N.',
      ur: 'یہ مقدار کماد کی فصل کے لیے 50 کلو بوری کے مطابق ہے؛ گنے کو زیادہ پوٹاش اور قسطوں میں نائٹروجن درکار ہوتی ہے۔',
    },
    stages: [
      {
        stageEn: 'At Planting',
        stageUr: 'کاشت کے وقت',
        timingEn: 'In trenches before placing setts',
        timingUr: 'کھیلیوں میں سمے (گنے کے ٹکڑے) رکھنے سے پہلے',
        guidanceEn: 'Incorporate 100% DAP, 100% SOP, and 1/4th Urea under the seed setts.',
        guidanceUr: 'پوری ڈی اے پی، پوٹاش اور چوتھا حصہ یوریا کھیلیوں کے نیچے ڈالیں۔',
      },
      {
        stageEn: 'Tillering & Earthing-Up',
        stageUr: 'پھوٹ اور مٹی چڑھانے کا مرحلہ (45–90 دن)',
        timingEn: 'Two to three split applications before June/Monsoon earthing-up',
        timingUr: 'مٹی چڑھانے سے پہلے 2 تا 3 قسطوں میں',
        guidanceEn: 'Apply remaining Urea in 2–3 equal splits with irrigation before final earthing-up.',
        guidanceUr: 'باقی یوریا مٹی چڑھانے سے پہلے 2 یا 3 برابر قسطوں میں پانی کے ساتھ دیں۔',
      },
    ],
    nutrientNotes: [
      {
        nutrient: 'N & K Balance',
        en: 'Adequate Potassium maintains sugar recovery (%) while preventing lodging under monsoon winds.',
        ur: 'پوٹاش کی مناسب مقدار گنے میں مٹھاس (شوگر ریکوری) بڑھاتی اور فصل کو گرنے سے بچاتی ہے۔',
      },
    ],
  },
  maize: {
    cropKey: 'maize',
    assumptions: {
      en: 'Hybrid irrigated maize assumptions using 50 kg bags; hybrid maize demands high side-dressed Urea.',
      ur: 'ہائبرڈ آبپاش مکئی اور 50 کلو بوری کے مطابق؛ ہائبرڈ مکئی کو بڑھوتری کے مرحلے پر مناسب یوریا درکار ہوتی ہے۔',
    },
    stages: [
      {
        stageEn: 'Basal Sowing Dose',
        stageUr: 'بوائی کے وقت',
        timingEn: 'On beds/ridges before sowing',
        timingUr: 'بوائی سے پہلے کھیلیوں یا ہموار زمین پر',
        guidanceEn: 'Apply full DAP and SOP plus 1/4th of Urea.',
        guidanceUr: 'پوری ڈی اے پی، پوٹاش اور یوریا کا چوتھا حصہ بوائی کے وقت ڈالیں۔',
      },
      {
        stageEn: 'Knee-High Stage (V6)',
        stageUr: 'گھٹنے کے برابر قد (25 تا 30 دن)',
        timingEn: '25–30 days after emergence',
        timingUr: 'اگاؤ کے 25 سے 30 دن بعد',
        guidanceEn: 'Side-dress half of remaining Urea near root zone prior to irrigation.',
        guidanceUr: 'باقی یوریا کا نصف حصہ جڑوں کے قریب ڈال کر پانی لگائیں۔',
      },
      {
        stageEn: 'Pre-Tasseling Stage',
        stageUr: 'بُھٹا/جھنڈا نکلنے سے پہلے (45–50 دن)',
        timingEn: '45–50 days after emergence',
        timingUr: 'اگاؤ کے 45 سے 50 دن بعد',
        guidanceEn: 'Apply final portion of Urea before earthing up and tasseling.',
        guidanceUr: 'سٹا/جھنڈا نکلنے اور مٹی چڑھانے سے پہلے آخری قسط یوریا دیں۔',
      },
    ],
    nutrientNotes: [
      {
        nutrient: 'P (DAP) & N (Urea)',
        en: 'Phosphorus drives rapid early vigor; missing nitrogen at knee-high stage sharply shrinks cob length.',
        ur: 'فاسفورس ابتدائی جڑ بناتی ہے جبکہ گھٹنے کے قد پر یوریا کی کمی سے چھلی چھوٹی رہ جاتی ہے۔',
      },
    ],
  },
  tomato: {
    cropKey: 'tomato',
    assumptions: {
      en: 'Open-field irrigated tomato assumptions in 50 kg bags; avoid excessive Nitrogen during fruit set to reduce blossom rot.',
      ur: 'کھلے کھیت میں کاشت ہونے والے ٹماٹر کے لیے 50 کلو بوری کے مطابق؛ پھل لگتے وقت ضرورت سے زیادہ یوریا نہ دیں۔',
    },
    stages: [
      {
        stageEn: 'Basal Transplanting Bed',
        stageUr: 'پنیری منتقلی کے وقت',
        timingEn: 'Before bed shaping',
        timingUr: 'پٹڑیاں بناتے وقت پنیری لگانے سے پہلے',
        guidanceEn: 'Incorporate full DAP, half SOP, and 1/3rd Urea into raised beds.',
        guidanceUr: 'پوری ڈی اے پی، آدھی پوٹاش اور تیسرا حصہ یوریا پٹڑیوں میں ملائیں۔',
      },
      {
        stageEn: 'Vegetative & Flowering Stage',
        stageUr: 'شاخیں اور پھول آنے کا مرحلہ (25–35 دن)',
        timingEn: '25–35 days after transplanting',
        timingUr: 'منتقلی کے 25 سے 35 دن بعد',
        guidanceEn: 'Side-dress second 1/3rd Urea carefully away from stems.',
        guidanceUr: 'تنے سے تھوڑا ہٹ کر یوریا کا دوسرا تیسرا حصہ دیں۔',
      },
      {
        stageEn: 'Fruit Enlargement',
        stageUr: 'پھل بننے اور پکنے کا مرحلہ (50+ دن)',
        timingEn: 'After first fruit set',
        timingUr: 'پہلا پھل لگنے کے بعد',
        guidanceEn: 'Apply final 1/3rd Urea and remaining SOP to improve fruit firmness and shelf life.',
        guidanceUr: 'پھل کی مضبوطی اور چمک کے لیے آخری حصہ یوریا اور باقی پوٹاش دیں۔',
      },
    ],
    nutrientNotes: [
      {
        nutrient: 'Potash + Balanced N',
        en: 'Potassium improves fruit firmness, lycopene color, and crack resistance.',
        ur: 'پوٹاش ٹماٹر کے پھل کو سخت، سرخ اور پھٹنے سے محفوظ رکھتی ہے۔',
      },
    ],
  },
};

export function getOfflineFertilizerSchedule(
  cropKey: string
): CropFertilizerStageSchedule {
  return CROP_SCHEDULES[cropKey] || CROP_SCHEDULES.wheat;
}

export async function saveFertilizerRecommendationHistory(
  result: FertilizerCalculationResult,
  cropNameEn: string,
  cropNameUr: string
): Promise<FertilizerHistoryRecord | null> {
  const now = Date.now();
  // Prevent accidental duplicate saves when user double-taps within 60 seconds
  try {
    const existing = await getFertilizerRecommendationHistory();
    const latest = existing[0];
    if (
      latest &&
      latest.cropKey === result.crop &&
      latest.soil === result.soil &&
      Math.abs(latest.areaAcres - result.areaAcres) < 0.001 &&
      now - latest.createdAt < 60_000
    ) {
      return latest;
    }
  } catch {
    // ignore dedup lookup failure and proceed to save
  }

  const schedule = getOfflineFertilizerSchedule(result.crop);
  const record: FertilizerHistoryRecord = {
    id: `fert_${now}_${result.crop}_${result.soil}`,
    cropKey: result.crop,
    cropNameEn,
    cropNameUr,
    soil: result.soil as SoilType,
    areaAcres: result.areaAcres,
    items: result.items.map((item) => ({
      product: item.product,
      kgPerAcre: item.kgPerAcre,
      totalKg: item.totalKg,
      bags50Kg: item.bags50Kg,
    })),
    source: result.source,
    assumptions: schedule.assumptions.en,
    createdAt: now,
  };

  const ok = await idbPut(OFFLINE_STORES.FERTILIZER_HISTORY, record);
  if (ok) {
    await idbPruneOldest(OFFLINE_STORES.FERTILIZER_HISTORY, 25, 'createdAt').catch(() => 0);
    notifyOfflineStateChanged();
    return record;
  }
  return null;
}

export async function getFertilizerRecommendationHistory(): Promise<
  FertilizerHistoryRecord[]
> {
  const rows = await idbGetAll<FertilizerHistoryRecord>(
    OFFLINE_STORES.FERTILIZER_HISTORY
  );
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 25);
}

export async function deleteFertilizerHistoryItem(id: string): Promise<boolean> {
  const ok = await idbDelete(OFFLINE_STORES.FERTILIZER_HISTORY, id);
  if (ok) notifyOfflineStateChanged();
  return ok;
}
