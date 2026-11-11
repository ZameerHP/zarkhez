import type { ProblemCategory, ScientificReference } from '../schemas';

/**
 * Zarkhez Agricultural Knowledge Base & Regional Differential Registry (lib/vision/knowledge-base.ts)
 * - Strictly grounded in verified institutional agricultural bodies (FAO, IRRI, CIMMYT, CABI, USDA, PARC/NARC, CCRI).
 * - Never fabricates DOIs, paper page numbers, or commercial chemical dosages.
 * - Supports all 11 core Pakistani field crops PLUS broader horticulture, pulses, oilseeds, and abiotic syndromes.
 */

export interface ExtendedCropMeta {
  slug: string;
  en: string;
  ur: string;
  aliases: string[];
  keyDifferentialsEn: string;
}

export const SUPPORTED_AGRICULTURAL_CROPS: ReadonlyArray<ExtendedCropMeta> = [
  {
    slug: 'auto',
    en: 'Auto-Detect / Other Plant',
    ur: 'خودکار پہچان / دیگر پودا',
    aliases: ['auto', 'unknown', 'other', 'any'],
    keyDifferentialsEn:
      'Identify crop species and organ first (leaf, stem, root, flower, fruit, cob, seed, grain, bark, soil, pest, stored produce) without forcing a crop mismatch.',
  },
  {
    slug: 'wheat',
    en: 'Wheat',
    ur: 'گندم',
    aliases: ['wheat', 'gandum', 'گندم'],
    keyDifferentialsEn:
      'Distinguish Yellow/Stripe Rust vs Leaf Rust vs Septoria Blotch vs Nitrogen/Waterlogging yellowing vs Frost tip burn.',
  },
  {
    slug: 'rice',
    en: 'Rice',
    ur: 'دھان (چاول)',
    aliases: ['rice', 'paddy', 'dhan', 'دھان', 'چاول'],
    keyDifferentialsEn:
      'Distinguish Rice Blast (spindle lesions) vs Brown Spot (circular oval spots) vs Bacterial Leaf Blight (water-soaked marginal stripes) vs Zinc Khaira deficiency vs Sheath Blight.',
  },
  {
    slug: 'cotton',
    en: 'Cotton',
    ur: 'کپاس',
    aliases: ['cotton', 'kapas', 'کپاس'],
    keyDifferentialsEn:
      'Distinguish Cotton Leaf Curl Virus (upward cup + enations) vs 2,4-D Herbicide Drift (strapping) vs Angular Bacterial Leaf Spot vs Whitefly/Jassid burn.',
  },
  {
    slug: 'maize',
    en: 'Maize',
    ur: 'مکئی',
    aliases: ['maize', 'corn', 'makai', 'مکئی'],
    keyDifferentialsEn:
      'For cobs/kernels compare Fusarium ear rot (pink/white/black dispersed starburst streaks) vs Diplodia ear rot (dense white-grey mold starting from cob base with blackened kernels) vs Gibberella ear rot (reddish mold from tip) vs Aspergillus. For leaves compare Maydis/Turcicum blight vs Fall Armyworm.',
  },
  {
    slug: 'sugarcane',
    en: 'Sugarcane',
    ur: 'کماد (گنا)',
    aliases: ['sugarcane', 'kamad', 'ganna', 'کماد', 'گنا'],
    keyDifferentialsEn:
      'Distinguish Red Rot (reddened split pith with cross-white bands) vs Pokkah Boeng vs Whip Smut vs Pyrilla/Borer damage.',
  },
  {
    slug: 'tomato',
    en: 'Tomato',
    ur: 'ٹماٹر',
    aliases: ['tomato', 'tamatar', 'ٹماٹر'],
    keyDifferentialsEn:
      'Distinguish Early Blight (concentric rings) vs Late Blight (water-soaked dark patches + white underside mold) vs Bacterial Spot/Canker vs Blossom-End Rot (Ca/water stress) vs ToLCV/TYLCV.',
  },
  {
    slug: 'potato',
    en: 'Potato',
    ur: 'آلو',
    aliases: ['potato', 'aloo', 'آلو'],
    keyDifferentialsEn:
      'Distinguish Late Blight vs Early Blight vs Black Scurf/Common Scab vs Bacterial Brown Rot vs Frost Blackening.',
  },
  {
    slug: 'chili',
    en: 'Chili / Pepper',
    ur: 'مرچ / شملہ مرچ',
    aliases: ['chili', 'chilli', 'pepper', 'mirch', 'مرچ'],
    keyDifferentialsEn:
      'Distinguish Chili Leaf Curl Virus vs Thrips/Mite curling (downward boat curl + silvery undersides) vs Anthracnose sunken fruit rot vs Phytophthora blight.',
  },
  {
    slug: 'onion',
    en: 'Onion / Garlic',
    ur: 'پیاز / لہسن',
    aliases: ['onion', 'garlic', 'pyaz', 'lehsan', 'پیاز', 'لہسن'],
    keyDifferentialsEn:
      'Distinguish Stemphylium / Purple Blotch (purplish concentric spots) vs Downy Mildew (pale purplish velvety mold) vs Thrips silver flecking vs Tip burn.',
  },
  {
    slug: 'mango',
    en: 'Mango',
    ur: 'آم',
    aliases: ['mango', 'aam', 'آم'],
    keyDifferentialsEn:
      'Distinguish Anthracnose (black tear-stain spots) vs Bacterial Black Spot (star-cracked raised lesions) vs Powdery Mildew vs Malformation vs Sunburn.',
  },
  {
    slug: 'citrus',
    en: 'Citrus / Kinnow',
    ur: 'کنو / مالٹا',
    aliases: ['citrus', 'kinnow', 'orange', 'lemon', 'مالٹا', 'کنو'],
    keyDifferentialsEn:
      'Distinguish Citrus Canker (corky craters with yellow halos) vs Citrus Greening/HLB (asymmetrical blotchy mottle) vs Zinc Deficiency (symmetrical interveinal chlorosis).',
  },
  {
    slug: 'apple',
    en: 'Apple / Pome',
    ur: 'سیب',
    aliases: ['apple', 'seb', 'سیب'],
    keyDifferentialsEn:
      'Distinguish Fire Blight (shepherd crook blackened shoots + ooze) vs Apple Scab (olive-black velvety lesions) vs Bitter Pit vs Sunscald.',
  },
  {
    slug: 'grapes',
    en: 'Grapes',
    ur: 'انگور',
    aliases: ['grape', 'grapes', 'angoor', 'انگور'],
    keyDifferentialsEn:
      'Distinguish Downy Mildew (yellow oil-spots + white underside down) vs Powdery Mildew (ashy white powder) vs Black Rot vs Anthracnose.',
  },
  {
    slug: 'pomegranate',
    en: 'Pomegranate',
    ur: 'انار',
    aliases: ['pomegranate', 'anaar', 'انار'],
    keyDifferentialsEn:
      'Distinguish Bacterial Blight (water-soaked oily angular leaf/fruit cracks) vs Cercospora spot vs Fruit cracking (irrigation fluctuation).',
  },
  {
    slug: 'guava',
    en: 'Guava',
    ur: 'امرود',
    aliases: ['guava', 'amrood', 'امرود'],
    keyDifferentialsEn:
      'Distinguish Guava Wilt (branch dieback + vascular browning) vs Anthracnose/Canker vs Fruit Fly puncture.',
  },
  {
    slug: 'pulses',
    en: 'Pulses / Chickpea / Beans / Peas',
    ur: 'دالیں / چنا / مٹر / لوبیا',
    aliases: ['pulses', 'chickpea', 'gram', 'chana', 'beans', 'peas', 'matar', 'چنا', 'مٹر', 'دالیں'],
    keyDifferentialsEn:
      'Distinguish Ascochyta Blight (concentric pycnidia bullseye rings) vs Fusarium Wilt (vascular browning without external rings) vs Botrytis Gray Mold vs Powdery Mildew.',
  },
  {
    slug: 'groundnut',
    en: 'Groundnut / Soybean / Sunflower',
    ur: 'مونگ پھلی / سویا بین / سورج مکھی',
    aliases: ['groundnut', 'peanut', 'soybean', 'sunflower', 'مونگ پھلی', 'سویا بین', 'سورج مکھی'],
    keyDifferentialsEn:
      'Distinguish Early/Late Tikka Leaf Spot (Cercospora) vs Soybean Rust vs Alternaria Blight vs Boron/Potash margin scorch.',
  },
  {
    slug: 'vegetables',
    en: 'Brinjal / Okra / Vegetables',
    ur: 'بینگن / بھنڈی / سبزیاں',
    aliases: ['brinjal', 'eggplant', 'okra', 'bhindi', 'vegetable', 'بینگن', 'بھنڈی', 'سبزی'],
    keyDifferentialsEn:
      'Distinguish Okra Yellow Vein Mosaic Virus vs Little Leaf Phytoplasma vs Phomopsis Blight vs Jassid hopperburn.',
  },
];

export const PAKISTAN_REGION_PROFILES: ReadonlyArray<{
  key: string;
  en: string;
  ur: string;
  climateNoteEn: string;
}> = [
  {
    key: 'central_punjab',
    en: 'Central Punjab (Rice-Wheat Irrigated)',
    ur: 'وسطی پنجاب (دھان۔گندم نہری علاقہ)',
    climateNoteEn: 'High post-monsoon humidity, dense winter fog/dew favoring Rice Blast, Brown Spot, Wheat Rust, and Late Blight.',
  },
  {
    key: 'south_punjab',
    en: 'South Punjab (Cotton-Wheat / Mango Belt)',
    ur: 'جنوبی پنجاب (کپاس۔گندم / آم بیلٹ)',
    climateNoteEn: 'Hot dry summers with heat stress, Whitefly-vectored CLCuV, Mango Malformation, and soil salinity pockets.',
  },
  {
    key: 'sindh_delta',
    en: 'Sindh Plains & Coastal Belt',
    ur: 'سندھ کے میدانی اور ساحلی علاقے',
    climateNoteEn: 'Warm humid winds, salinity/waterlogging pressure, Banana/Chili Leaf Curl, Onion Purple Blotch, and Rice Stem/Sheath stress.',
  },
  {
    key: 'potohar_rainfed',
    en: 'Potohar Rainfed (Barani)',
    ur: 'پوٹھوہار بارانی علاقہ',
    climateNoteEn: 'Moisture stress variability, Groundnut Tikka spot, Chickpea Ascochyta blight, and Yellow Rust along cool northern winds.',
  },
  {
    key: 'kp_valleys',
    en: 'Khyber Pakhtunkhwa (Valleys & Orchards)',
    ur: 'خیبر پختونخوا (وادیاں اور باغات)',
    climateNoteEn: 'Cool foothills and orchards favoring Apple Fire Blight, Apple Scab, Wheat Stripe Rust, and Maize Turcicum Leaf Blight.',
  },
  {
    key: 'balochistan_arid',
    en: 'Balochistan (Arid Uplands & Orchards)',
    ur: 'بلوچستان (خشک اور باغات کے علاقے)',
    climateNoteEn: 'High diurnal temperature swing, frost risk on Grapes/Apple/Pomegranate, zinc/iron tie-up in calcareous soils, and drip moisture stress.',
  },
];

const CURATED_SCIENTIFIC_REFERENCES: Record<string, ScientificReference> = {
  fao: {
    source: 'FAO',
    title: 'FAO Plant Production and Protection Division — Integrated Pest & Disease Management',
    url: 'https://www.fao.org/pest-and-pesticide-management/en/',
  },
  cabi: {
    source: 'CABI',
    title: 'CABI PlantwisePlus Knowledge Bank — Crop Pathology & Differential Fact Sheets',
    url: 'https://plantwiseplusknowledgebank.org/',
  },
  irri: {
    source: 'IRRI',
    title: 'IRRI Rice Knowledge Bank — Rice Disease, Blast, BLB & Nutrient Diagnostics',
    url: 'http://www.knowledgebank.irri.org/',
  },
  cimmyt: {
    source: 'CIMMYT',
    title: 'CIMMYT Wheat & Maize Disease Field Guides (Rusts & Ear Rots)',
    url: 'https://www.cimmyt.org/',
  },
  parc: {
    source: 'PARC / NARC',
    title: 'Pakistan Agricultural Research Council — Regional Crop Protection Advisories',
    url: 'https://www.parc.gov.pk/',
  },
  usda: {
    source: 'USDA ARS',
    title: 'USDA Plant Disease, Mycotoxin & Abiotic Injury Compendia',
    url: 'https://www.ars.usda.gov/',
  },
};

export function getVerifiedScientificReferences(params: {
  crop?: string;
  problemCategory?: ProblemCategory;
  pathogenType?: string;
}): ScientificReference[] {
  const c = (params.crop || '').toLowerCase();
  const refs: ScientificReference[] = [CURATED_SCIENTIFIC_REFERENCES.cabi];

  if (c.includes('rice') || c.includes('paddy') || c.includes('دھان')) {
    refs.unshift(CURATED_SCIENTIFIC_REFERENCES.irri);
  }
  if (c.includes('wheat') || c.includes('maize') || c.includes('corn') || c.includes('گندم') || c.includes('مکئی')) {
    refs.unshift(CURATED_SCIENTIFIC_REFERENCES.cimmyt);
  }
  refs.push(CURATED_SCIENTIFIC_REFERENCES.parc);

  if (
    params.problemCategory === 'chemical_herbicide_injury' ||
    params.problemCategory === 'post_harvest_storage' ||
    params.problemCategory === 'soil_salinity' ||
    params.pathogenType === 'environmental_stress'
  ) {
    refs.push(CURATED_SCIENTIFIC_REFERENCES.usda);
  } else {
    refs.push(CURATED_SCIENTIFIC_REFERENCES.fao);
  }

  return Array.from(new Map(refs.map((r) => [r.source, r])).values()).slice(0, 4);
}

export function getRegionalRiskNote(regionKey?: string): string {
  if (!regionKey) return '';
  const low = regionKey.toLowerCase();
  const match = PAKISTAN_REGION_PROFILES.find(
    (r) =>
      r.key === low ||
      r.en.toLowerCase().includes(low) ||
      low.includes(r.key.split('_')[0])
  );
  if (!match) {
    return `- Farmer Geographical Region Context: ${regionKey} (factor local climate/humidity only where visual symptoms align).`;
  }
  return `- Regional Agro-Climatic Context (${match.en}): ${match.climateNoteEn}`;
}
