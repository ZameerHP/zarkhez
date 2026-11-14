'use client';

/**
 * Exact 38 PlantVillage classes from:
 * onnx-community/mobilenet_v2_1.0_224-plant-disease-identification-ONNX (config.json)
 *
 * Strictly distinguishes crops supported by the local ONNX weights from unsupported
 * crops (Wheat, Rice, Cotton, Sugarcane, Mango, etc.) so results are never fabricated.
 */

export interface PlantVillageClassMeta {
  idx: number;
  rawLabel: string;
  cropKey: string;
  isHealthy: boolean;
  pathogenType:
    | 'fungal'
    | 'bacterial'
    | 'viral'
    | 'pest'
    | 'healthy'
    | 'unknown';
  title: {
    en: string;
    ur: string;
    sd: string;
  };
  actions: {
    en: string[];
    ur: string[];
    sd: string[];
  };
  prevention: {
    en: string[];
    ur: string[];
  };
}

export const PLANTVILLAGE_RAW_LABELS: readonly string[] = [
  'Apple___Apple_scab',
  'Apple___Black_rot',
  'Apple___Cedar_apple_rust',
  'Apple___healthy',
  'Blueberry___healthy',
  'Cherry_(including_sour)___Powdery_mildew',
  'Cherry_(including_sour)___healthy',
  'Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot',
  'Corn_(maize)___Common_rust_',
  'Corn_(maize)___Northern_Leaf_Blight',
  'Corn_(maize)___healthy',
  'Grape___Black_rot',
  'Grape___Esca_(Black_Measles)',
  'Grape___Leaf_blight_(Isariopsis_Leaf_Spot)',
  'Grape___healthy',
  'Orange___Haunglongbing_(Citrus_greening)',
  'Peach___Bacterial_spot',
  'Peach___healthy',
  'Pepper,_bell___Bacterial_spot',
  'Pepper,_bell___healthy',
  'Potato___Early_blight',
  'Potato___Late_blight',
  'Potato___healthy',
  'Raspberry___healthy',
  'Soybean___healthy',
  'Squash___Powdery_mildew',
  'Strawberry___Leaf_scorch',
  'Strawberry___healthy',
  'Tomato___Bacterial_spot',
  'Tomato___Early_blight',
  'Tomato___Late_blight',
  'Tomato___Leaf_Mold',
  'Tomato___Septoria_leaf_spot',
  'Tomato___Spider_mites Two-spotted_spider_mite',
  'Tomato___Target_Spot',
  'Tomato___Tomato_Yellow_Leaf_Curl_Virus',
  'Tomato___Tomato_mosaic_virus',
  'Tomato___healthy',
];

const CROP_KEY_TO_PV_HOST: Record<string, string> = {
  tomato: 'tomato',
  tamatar: 'tomato',
  ٹماٹر: 'tomato',
  ٽماٽر: 'tomato',
  maize: 'corn',
  corn: 'corn',
  makai: 'corn',
  مکئی: 'corn',
  مڪئي: 'corn',
  potato: 'potato',
  aloo: 'potato',
  aaloo: 'potato',
  آلو: 'potato',
  پٽاٽو: 'potato',
  chili: 'pepper',
  chilli: 'pepper',
  pepper: 'pepper',
  bell_pepper: 'pepper',
  mirch: 'pepper',
  مرچ: 'pepper',
  مرچيون: 'pepper',
  citrus: 'orange',
  orange: 'orange',
  kinnow: 'orange',
  malta: 'orange',
  کینو: 'orange',
  مالٹا: 'orange',
  ليمون: 'orange',
  apple: 'apple',
  سیب: 'apple',
  صوف: 'apple',
  grape: 'grape',
  انگور: 'grape',
  peach: 'peach',
  آڑو: 'peach',
  strawberry: 'strawberry',
  mango: 'unsupported',
  aam: 'unsupported',
  آم: 'unsupported',
  انب: 'unsupported',
  wheat: 'unsupported',
  gandum: 'unsupported',
  گندم: 'unsupported',
  ڪڻڪ: 'unsupported',
  rice: 'unsupported',
  paddy: 'unsupported',
  dhan: 'unsupported',
  chawal: 'unsupported',
  چاول: 'unsupported',
  دھان: 'unsupported',
  ساريون: 'unsupported',
  cotton: 'unsupported',
  kapas: 'unsupported',
  کپاس: 'unsupported',
  وونئڻ: 'unsupported',
  sugarcane: 'unsupported',
  ganna: 'unsupported',
  kamad: 'unsupported',
  گنا: 'unsupported',
  کماد: 'unsupported',
  ڪمند: 'unsupported',
  onion: 'unsupported',
  pyaz: 'unsupported',
  پیاز: 'unsupported',
  بصر: 'unsupported',
};

export function normalizeSelectedCropToPvHost(cropKey: string): string {
  const normalized = (cropKey || '').trim().toLowerCase();
  if (!normalized) return 'unsupported';
  const mapped = CROP_KEY_TO_PV_HOST[normalized];
  if (mapped) return mapped;

  // Substring safety check for display labels like "Tomato / ٹماٹر" or "Wheat (Gandum)"
  for (const [alias, host] of Object.entries(CROP_KEY_TO_PV_HOST)) {
    if (alias.length >= 3 && normalized.includes(alias)) {
      return host;
    }
  }
  return 'unsupported';
}

export function isCropSupportedByPlantVillageOnnx(cropKey: string): boolean {
  const mapped = normalizeSelectedCropToPvHost(cropKey);
  return Boolean(mapped && mapped !== 'unsupported');
}

export function extractPvHostFromLabel(rawLabel: string): string {
  const lower = rawLabel.toLowerCase();
  if (lower.startsWith('tomato')) return 'tomato';
  if (lower.startsWith('corn_(maize)')) return 'corn';
  if (lower.startsWith('potato')) return 'potato';
  if (lower.startsWith('pepper')) return 'pepper';
  if (lower.startsWith('orange')) return 'orange';
  if (lower.startsWith('apple')) return 'apple';
  if (lower.startsWith('grape')) return 'grape';
  if (lower.startsWith('peach')) return 'peach';
  if (lower.startsWith('cherry')) return 'cherry';
  if (lower.startsWith('squash')) return 'squash';
  if (lower.startsWith('strawberry')) return 'strawberry';
  if (lower.startsWith('soybean')) return 'soybean';
  return 'other';
}

const CUSTOM_TRANSLATIONS: Record<
  number,
  {
    ur: string;
    sd: string;
    pathogenType: PlantVillageClassMeta['pathogenType'];
    enAction: string[];
    urAction: string[];
    sdAction: string[];
  }
> = {
  7: {
    ur: 'مکئی کا گرے لیف اسپاٹ (پتوں کے بھورے دھبے)',
    sd: 'مڪئي جي پنن تي ڀورا داغ',
    pathogenType: 'fungal',
    enAction: [
      'Inspect lower maize leaves for rectangular tan/gray lesions along veins.',
      'Improve spacing/airflow where possible and remove heavily blighted crop residue after harvest.',
      'Verify with an agriculture officer before fungicide treatment if spreading rapidly above ear leaf.',
    ],
    urAction: [
      'نچلے مکئی کے پتوں پر مستطیل بھورے/سرمئی دھبوں کا معائنہ کریں۔',
      'فصل کی باقیات کٹائی کے بعد کھیت سے صاف کریں اور کھیت میں ہوا کا گزر بہتر بنائیں۔',
      'اگر بھُٹے کے پتے سے اوپر بیماری پھیل رہی ہو تو زرعی افسر سے سپرے کی تصدیق کروائیں۔',
    ],
    sdAction: [
      'هيٺين پنن تي داغن جو معائنو ڪريو ۽ فصل جي باقيات صاف ڪريو.',
      'تيز پکيڙ تي زرعي ماهر کان تصديق ڪرايو.',
    ],
  },
  8: {
    ur: 'مکئی کا عام زنگ (کامن رسٹ)',
    sd: 'مڪئي جي عام ڪنگي',
    pathogenType: 'fungal',
    enAction: [
      'Confirm dusty reddish-brown pustules on both upper and lower maize leaf surfaces.',
      'Scout field dispersion before deciding on fungicide intervention.',
    ],
    urAction: [
      'مکئی کے پتے کی دونوں سطحوں پر بھورے پاؤڈر جیسے دانوں کی جانچ کریں۔',
      'سپرے سے پہلے پورے کھیت میں پھیلاؤ کی شرح چیک کریں اور زرعی افسر سے مشورہ لیں۔',
    ],
    sdAction: [
      'پن جي ٻنهي پاسن تي ڀورو پائوڊر چيڪ ڪريو ۽ پکيڙ جو اندازو لڳايو.',
    ],
  },
  9: {
    ur: 'مکئی کا ناردرن لیف بلائٹ (پتوں کا جھلساؤ)',
    sd: 'مڪئي جي پنن جو جھلساءُ',
    pathogenType: 'fungal',
    enAction: [
      'Look for long cigar-shaped grayish-green or tan lesions on leaves.',
      'Protect upper ear-level leaves; plow down infected stover after harvest and rotate crops.',
    ],
    urAction: [
      'پتوں پر لمبوترے سرمئی سبز جھلسے ہوئے دھبے دیکھیں۔',
      'کٹائی کے بعد متاثرہ باقیات زمین میں دبا دیں اور فصلوں کا ہیر پھیر کریں۔',
    ],
    sdAction: [
      'پنن تي ڊگھا جھلسيل داغ ڏسو ۽ لاباري بعد فصل مٽايو.',
    ],
  },
  15: {
    ur: 'ترشاوہ/کینو کا سٹرس گریننگ (HLB / پتوں کا پیلا پن)',
    sd: 'ليمن ۽ مالٽي جو سٽرس گريننگ روڳ',
    pathogenType: 'bacterial',
    enAction: [
      'Check for asymmetrical blotchy yellow mottling on citrus leaves and small lop-sided bitter fruit.',
      'Control Asian Citrus Psyllid (vector) strictly and consult horticulture extension before pruning/tree removal.',
    ],
    urAction: [
      'کینو/مالٹے کے پتوں پر بے ترتیب پیلے دھبے اور چھوٹے ترچھے پھل کی جانچ کریں۔',
      'رس چوسنے والے سٹرس سائیلا کیڑے کا تدارک کریں اور باغبانی ماہر سے درخت کا معائنہ کروائیں۔',
    ],
    sdAction: [
      'پنن تي پيلا داغ چيڪ ڪريو ۽ سٽرس سائيلا جيت تي ضابطو آڻيو.',
    ],
  },
  20: {
    ur: 'آلو کا اگیتا جھلساؤ (ارلی بلائٹ)',
    sd: 'پٽاٽن جو اڳوڻو جھلساءُ',
    pathogenType: 'fungal',
    enAction: [
      'Check older leaves for dark brown concentric target-like rings.',
      'Maintain balanced soil moisture and avoid foliar wetness late evening.',
    ],
    urAction: [
      'آلو کے نچلے پتوں پر گول دائروں والے سیاہ دھبے چیک کریں۔',
      'متوازن آبپاشی کریں اور شام کے وقت پتوں کو گیلا کرنے سے بچیں۔',
    ],
    sdAction: [
      'هيٺين پنن تي گول داغ چيڪ ڪريو ۽ شام جو پاڻي نه وجھو.',
    ],
  },
  21: {
    ur: 'آلو کا پچھیتا جھلساؤ (لیٹ بلائٹ)',
    sd: 'پٽاٽن جو پويون جھلساءُ',
    pathogenType: 'fungal',
    enAction: [
      'URGENT: Inspect cool wet fields for dark water-soaked patches with white mold beneath leaves.',
      'Contact your local plant protection/extension specialist promptly; Late Blight spreads rapidly.',
    ],
    urAction: [
      'فوری توجہ: ٹھنڈے مرطوب موسم میں پتے کے نیچے سفید روئی کے ساتھ گہرے گیلے دھبوں کی جانچ کریں۔',
      'پچھیتا جھلساؤ تیزی سے پھیلتا ہے — فوراً مقامی زرعی افسر سے تصدیق کروائیں۔',
    ],
    sdAction: [
      'فوري توجهه: هي بيماري تيزيءَ سان پکڙجي ٿي، فوري زرعي ماهر سان رابطو ڪريو.',
    ],
  },
  28: {
    ur: 'ٹماٹر کا بیکٹیریل اسپاٹ',
    sd: 'ٽماٽر جو بيڪٽيريل اسپاٽ',
    pathogenType: 'bacterial',
    enAction: [
      'Avoid touching wet plants (rain/dew spreads bacterial spots mechanically).',
      'Remove heavily spotted bottom leaves cleanly and irrigate at furrow base only.',
    ],
    urAction: [
      'گیلے پودوں کو ہاتھ نہ لگائیں کیونکہ شبنم یا بارش میں بیکٹیریا تیزی سے پھیلتے ہیں۔',
      'نیچے کے متاثرہ پتے ہٹائیں اور پانی صرف کھیلیوں میں لگائیں۔',
    ],
    sdAction: [
      'گهميل ٻوٽن کي هٿ نه لڳايو ۽ رڳو خالين ۾ پاڻي ڏيو.',
    ],
  },
  29: {
    ur: 'ٹماٹر کا اگیتا جھلساؤ (ارلی بلائٹ)',
    sd: 'ٽماٽر جو اڳوڻو جھلساءُ',
    pathogenType: 'fungal',
    enAction: [
      'Prune lower foliage touching soil and mulch beds to block soil spore splash.',
      'Consult extension specialist for targeted protectant spray if lesions climb mid-canopy.',
    ],
    urAction: [
      'زمین کو چھونے والے نچلے متاثرہ پتے کاٹ کر کھیت سے دور تلف کریں۔',
      'اگر دھبے اوپر کی شاخوں تک پھیلیں تو زرعی ماہر سے مشورہ کریں۔',
    ],
    sdAction: [
      'زمين کي ڇهندڙ هيٺيان پن ڪٽي ٻاهر ڪڍو.',
    ],
  },
  30: {
    ur: 'ٹماٹر کا پچھیتا جھلساؤ (لیٹ بلائٹ)',
    sd: 'ٽماٽر جو پويون جھلساءُ',
    pathogenType: 'fungal',
    enAction: [
      'Look for dark water-soaked lesions and white fungal growth underneath during cool damp mornings.',
      'Remove worst infected stems cleanly and verify field-level fungicide action urgently.',
    ],
    urAction: [
      'ٹھنڈے مرطوب موسم میں پتے کے نیچے سفید تہہ اور گہرے گیلے دھبے دیکھیں۔',
      'شدید متاثرہ شاخیں فوراً الگ کریں اور زرعی افسر سے حفاظتی سپرے کی تصدیق کریں۔',
    ],
    sdAction: [
      'فوري متاثر ٽاريون الڳ ڪريو ۽ زرعي ماهر کان تصديق وٺو.',
    ],
  },
  35: {
    ur: 'ٹماٹر کا پیلا پتہ مروڑ وائرس (TYLCV)',
    sd: 'ٽماٽر جو پيلو پن مڙڻ وارو وائرس',
    pathogenType: 'viral',
    enAction: [
      'Viral disease spread by Whitefly (no chemical spray cures the virus once infected).',
      'Uproot severely curled early plants to stop spread and manage Whitefly populations carefully.',
    ],
    urAction: [
      'یہ وائرل بیماری سفید مکھی سے پھیلتی ہے (متاثرہ پودا دوا سے ٹھیک نہیں ہوتا)۔',
      'شدید متاثرہ ابتدائی پودے اکھاڑ کر تلف کریں اور سفید مکھی کا تدارک کریں۔',
    ],
    sdAction: [
      'هي وائرس سفيد مک کان پکڙجي ٿو؛ شديد متاثر ٻوٽا پٽي ختم ڪريو ۽ سفيد مک تي ضابطو آڻيو.',
    ],
  },
};

export function getPlantVillageClassMeta(idx: number): PlantVillageClassMeta {
  const rawLabel = PLANTVILLAGE_RAW_LABELS[idx] || 'Unknown___unknown';
  const [rawCrop, rawDisease] = rawLabel.split('___');
  const cropDisplay = (rawCrop || 'Plant')
    .replace(/_/g, ' ')
    .replace(/,/g, '')
    .replace('(including sour)', '')
    .trim();
  const diseaseDisplay = (rawDisease || 'Unknown').replace(/_/g, ' ').trim();
  const isHealthy = diseaseDisplay.toLowerCase() === 'healthy';
  const custom = CUSTOM_TRANSLATIONS[idx];

  const pathogenType: PlantVillageClassMeta['pathogenType'] = custom
    ? custom.pathogenType
    : isHealthy
    ? 'healthy'
    : diseaseDisplay.toLowerCase().includes('virus')
    ? 'viral'
    : diseaseDisplay.toLowerCase().includes('bacterial')
    ? 'bacterial'
    : diseaseDisplay.toLowerCase().includes('mite')
    ? 'pest'
    : 'fungal';

  const enTitle = isHealthy
    ? `Healthy ${cropDisplay} Leaf (No Typical Lesion Pattern)`
    : `${cropDisplay} — ${diseaseDisplay}`;
  const urTitle = custom
    ? custom.ur
    : isHealthy
    ? `صحت مند ${cropDisplay} کا پتا`
    : `${cropDisplay}: ${diseaseDisplay}`;
  const sdTitle = custom
    ? custom.sd
    : isHealthy
    ? `صحتمند ${cropDisplay} جو پن`
    : `${cropDisplay}: ${diseaseDisplay}`;

  const defaultEnAction = isHealthy
    ? [
        'Keep normal irrigation and balanced fertilization.',
        'Recheck field weekly and re-scan with Cloud Vision if spots appear later.',
      ]
    : [
        `On-device model matched symptom pattern resembling ${diseaseDisplay} on ${cropDisplay}.`,
        'Inspect 20+ field plants carefully and verify with online Cloud Vision or a local extension officer before applying pesticides.',
      ];

  const defaultUrAction = isHealthy
    ? [
        'معمول کے مطابق متوازن آبپاشی اور کھاد جاری رکھیں۔',
        'اگر بعد میں دھبے نظر آئیں تو آن لائن کلاؤڈ معائنہ ضرور کریں۔',
      ]
    : [
        `فون پر موجود آف لائن ماڈل نے علامات کو "${diseaseDisplay}" سے مشابہ قرار دیا ہے۔`,
        'سپرے کرنے سے پہلے کم از کم 20 پودوں کا معائنہ کریں اور آن لائن کلاؤڈ AI یا زرعی افسر سے تصدیق کروائیں۔',
      ];

  const defaultSdAction = isHealthy
    ? ['معمول موجب پاڻي ۽ ڀاڻ جاري رکو.']
    : ['اسپري کان اڳ آن لائن اسڪين يا زرعي ماهر کان تصديق ڪرايو.'];

  return {
    idx,
    rawLabel,
    cropKey: extractPvHostFromLabel(rawLabel),
    isHealthy,
    pathogenType,
    title: {
      en: enTitle,
      ur: urTitle,
      sd: sdTitle,
    },
    actions: {
      en: custom?.enAction ?? defaultEnAction,
      ur: custom?.urAction ?? defaultUrAction,
      sd: custom?.sdAction ?? defaultSdAction,
    },
    prevention: {
      en: [
        'Remove heavily infected lower leaves away from crop fields.',
        'Avoid overhead evening watering and follow crop rotation across seasons.',
      ],
      ur: [
        'شدید متاثرہ نچلے پتے کھیت سے باہر تلف کریں۔',
        'شام کے وقت اوپر سے آبپاشی سے بچیں اور فصلوں کا ہیر پھیر اپنائیں۔',
      ],
    },
  };
}
