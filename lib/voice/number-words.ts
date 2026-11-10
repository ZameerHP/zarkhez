import type { VoiceLang } from './types';

/**
 * Complete Pakistani Urdu (ur-PK) 0..99 words table.
 * Handles South Asian irregular compound forms cleanly (e.g., 27 ستائیس, 41 اکتالیس, 79 اناسی).
 */
export const URDU_0_TO_99: readonly string[] = [
  'صفر', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو',
  'دس', 'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس',
  'بیس', 'اکیس', 'بائیس', 'تئیس', 'چوبیس', 'پچیس', 'چھبیس', 'ستائیس', 'اٹھائیس', 'انتیس',
  'تیس', 'اکتیس', 'بتیس', 'تینتیس', 'چونتیس', 'پینتیس', 'چھتیس', 'سینتیس', 'اڑتیس', 'انتالیس',
  'چالیس', 'اکتالیس', 'بیالیس', 'تینتالیس', 'چوالیس', 'پینتالیس', 'چھیالیس', 'سینتالیس', 'اڑتالیس', 'انچاس',
  'پچاس', 'اکیاون', 'باون', 'ترپن', 'چون', 'پچپن', 'چھپن', 'ستاون', 'اٹھاون', 'انسٹھ',
  'ساٹھ', 'اکسٹھ', 'باسٹھ', 'ترسٹھ', 'چونسٹھ', 'پینسٹھ', 'چھیاسٹھ', 'سڑسٹھ', 'اڑسٹھ', 'انہتر',
  'ستر', 'اکہتر', 'بہتر', 'تہتر', 'چوہتر', 'پچہتر', 'چھہتر', 'ستہتر', 'اٹھہتر', 'اناسی',
  'اسی', 'اکیاسی', 'بیاسی', 'تراسی', 'چوراسی', 'پچاسی', 'چھیاسی', 'ستاسی', 'اٹھاسی', 'نواسی',
  'نوے', 'اکیانوے', 'بانوے', 'ترانوے', 'چورانوے', 'پچانوے', 'چھیانوے', 'ستانوے', 'اٹھانوے', 'ننانوے',
];

/**
 * Sindhi (sd-PK, Arabic script) 0..99 draft table.
 * Every Sindhi number/unit form carries needs_native_review = true until signed off by native Sindhi reviewer.
 */
export const SINDHI_0_TO_99: readonly string[] = [
  'ٻڙي', 'هڪ', 'ٻه', 'ٽي', 'چار', 'پنج', 'ڇهه', 'ست', 'اٺ', 'نو',
  'ڏهه', 'يارهن', 'ٻارهن', 'تيرهن', 'چوڏهن', 'پندرهن', 'سورهن', 'سترهن', 'ارڙهن', 'اوڻيهه',
  'ويهه', 'ايڪيهه', 'ٻاويهه', 'ٽيويهه', 'چوويهه', 'پنجويهه', 'ڇويهه', 'ستاويهه', 'اٺاويهه', 'اوڻٽيهه',
  'ٽيهه', 'ايڪٽيهه', 'ٻٽيهه', 'ٽيٽيهه', 'چوٽيهه', 'پنجٽيهه', 'ڇٽيهه', 'ستٽيهه', 'اٺٽيهه', 'اوڻيتاليهه',
  'چاليهه', 'ايڪيتاليهه', 'ٻائيتاليهه', 'ٽيئيتاليهه', 'چوئيتاليهه', 'پنجيتاليهه', 'ڇائيتاليهه', 'ستيتاليهه', 'اٺيتاليهه', 'اوڻونجاهه',
  'پنجاهه', 'ايڪونجاهه', 'ٻاونجاهه', 'ٽيونجاهه', 'چونجاهه', 'پنجونجاهه', 'ڇاونجاهه', 'ستونجاهه', 'اٺونجاهه', 'اوڻهٺ',
  'سٺ', 'ايڪهٺ', 'ٻاهٺ', 'ٽيهٺ', 'چوهٺ', 'پنجهٺ', 'ڇاهٺ', 'ستهٺ', 'اٺهٺ', 'اوڻهتر',
  'ستر', 'ايڪهتر', 'ٻاهتر', 'ٽيهتر', 'چوهتر', 'پنجهتر', 'ڇاهتر', 'ستهتر', 'اٺهتر', 'اوڻاسي',
  'اسي', 'ايڪاسي', 'ٻياسي', 'ٽياسي', 'چوراسي', 'پنجاسي', 'ڇهاسي', 'ستاسي', 'اٺاسي', 'اوڻانوي',
  'نوي', 'ايڪانوي', 'ٻيانوي', 'ٽيانوي', 'چورانوي', 'پنجانوي', 'ڇهانوي', 'ستانوي', 'اٺانوي', 'نوانوي',
];

const ENGLISH_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const ENGLISH_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function englishUnder1000(n: number): string {
  if (n < 20) return ENGLISH_ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r ? `${ENGLISH_TENS[t]} ${ENGLISH_ONES[r]}` : ENGLISH_TENS[t];
  }
  const h = Math.floor(n / 100);
  const rem = n % 100;
  return rem ? `${ENGLISH_ONES[h]} hundred ${englishUnder1000(rem)}` : `${ENGLISH_ONES[h]} hundred`;
}

export function integerToWords(nInput: number, lang: VoiceLang): string {
  if (!Number.isFinite(nInput)) return '';
  const negative = nInput < 0;
  let n = Math.floor(Math.abs(nInput));

  if (n === 0) {
    if (lang === 'ur') return URDU_0_TO_99[0];
    if (lang === 'sd') return SINDHI_0_TO_99[0];
    return ENGLISH_ONES[0];
  }

  if (lang === 'en') {
    const parts: string[] = [];
    const crore = Math.floor(n / 10_000_000);
    n %= 10_000_000;
    const lakh = Math.floor(n / 100_000);
    n %= 100_000;
    const thousand = Math.floor(n / 1000);
    const rest = n % 1000;
    if (crore) parts.push(`${englishUnder1000(crore)} crore`);
    if (lakh) parts.push(`${englishUnder1000(lakh)} lakh`);
    if (thousand) parts.push(`${englishUnder1000(thousand)} thousand`);
    if (rest) parts.push(englishUnder1000(rest));
    return (negative ? 'minus ' : '') + parts.join(' ');
  }

  const table = lang === 'sd' ? SINDHI_0_TO_99 : URDU_0_TO_99;
  const hundredWord = lang === 'sd' ? 'سئو' : 'سو';
  const thousandWord = lang === 'sd' ? 'هزار' : 'ہزار';
  const lakhWord = lang === 'sd' ? 'لک' : 'لاکھ';
  const croreWord = lang === 'sd' ? 'ڪروڙ' : 'کروڑ';
  const minusWord = lang === 'sd' ? 'ڪٽ' : 'منفی';

  const convertUnder1000 = (num: number): string => {
    if (num === 0) return '';
    if (num < 100) return table[num];
    const h = Math.floor(num / 100);
    const rem = num % 100;
    const prefix = h === 1 && lang === 'sd' ? `هڪ ${hundredWord}` : h === 1 && lang === 'ur' ? 'ایک سو' : `${table[h]} ${hundredWord}`;
    return rem ? `${prefix} ${table[rem]}` : prefix;
  };

  const segments: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  const rem = n % 1000;

  if (crore) segments.push(`${convertUnder1000(crore)} ${croreWord}`);
  if (lakh) segments.push(`${convertUnder1000(lakh)} ${lakhWord}`);
  if (thousand) segments.push(`${convertUnder1000(thousand)} ${thousandWord}`);
  if (rem) segments.push(convertUnder1000(rem));

  return (negative ? `${minusWord} ` : '') + segments.join(' ').trim();
}

export function numberStringToWords(raw: string, lang: VoiceLang): string {
  const clean = raw.replace(/,/g, '').trim();
  if (!clean) return raw;

  if (clean.includes('.')) {
    const [intPartRaw, fracPartRaw] = clean.split('.');
    const intNum = intPartRaw === '' || intPartRaw === '-' ? 0 : Number(intPartRaw);
    if (!Number.isFinite(intNum)) return raw;
    const intWords = integerToWords(intNum, lang);
    const pointWord = lang === 'ur' ? 'اعشاریہ' : lang === 'sd' ? 'ڏهائي' : 'point';
    const fracDigits = fracPartRaw
      .split('')
      .map((d) => {
        const digit = Number(d);
        return Number.isInteger(digit) ? integerToWords(digit, lang) : d;
      })
      .join(' ');
    return `${intWords} ${pointWord} ${fracDigits}`.trim();
  }

  const parsed = Number(clean);
  if (!Number.isFinite(parsed)) return raw;
  return integerToWords(parsed, lang);
}

export function ordinalToWords(n: number, lang: VoiceLang): string {
  if (lang === 'ur') {
    const map: Record<number, string> = {
      1: 'پہلا',
      2: 'دوسرا',
      3: 'تیسرا',
      4: 'چوتھا',
      5: 'پانچواں',
      6: 'چھٹا',
      7: 'ساتواں',
      8: 'آٹھواں',
      9: 'نواں',
      10: 'دسواں',
    };
    return map[n] || `${integerToWords(n, 'ur')} واں`;
  }
  if (lang === 'sd') {
    const map: Record<number, string> = {
      1: 'پهريون',
      2: 'ٻيو',
      3: 'ٽيون',
      4: 'چوٿون',
      5: 'پنجون',
      6: 'ڇهون',
      7: 'ستون',
      8: 'اٺون',
      9: 'نائون',
      10: 'ڏهون',
    };
    return map[n] || `${integerToWords(n, 'sd')} ون`;
  }
  const suffixMap: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' };
  return suffixMap[n] || `${integerToWords(n, 'en')}th`;
}

/**
 * Converts 24h or 12h clock times like "06:39" or "17:41" into natural spoken Pakistani time phrases.
 * Examples (ur):
 *  - "06:39" -> "صبح چھ بج کر انتالیس منٹ"
 *  - "17:41" -> "شام پانچ بج کر اکتالیس منٹ"
 */
export function timeToSpokenWords(hourRaw: number, minRaw: number, lang: VoiceLang): string {
  const hour24 = ((hourRaw % 24) + 24) % 24;
  const min = Math.max(0, Math.min(59, minRaw));
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  if (lang === 'en') {
    const period =
      hour24 < 5 ? 'at night' : hour24 < 12 ? 'in the morning' : hour24 < 17 ? 'in the afternoon' : 'in the evening';
    const hourWords = integerToWords(hour12, 'en');
    if (min === 0) return `${hourWords} o'clock ${period}`;
    return `${hourWords} ${min < 10 ? `oh ${integerToWords(min, 'en')}` : integerToWords(min, 'en')} ${period}`;
  }

  if (lang === 'sd') {
    const period =
      hour24 < 4
        ? 'رات جو'
        : hour24 < 12
        ? 'صبح جو'
        : hour24 < 16
        ? 'منجهند جو'
        : hour24 < 20
        ? 'شام جو'
        : 'رات جو';
    const hourWords = integerToWords(hour12, 'sd');
    if (min === 0) return `${period} ${hourWords} وڳي`;
    const minWords = integerToWords(min, 'sd');
    return `${period} ${hourWords} لڳي ${minWords} منٽ`;
  }

  // Urdu (ur-PK)
  const period =
    hour24 < 4
      ? 'رات'
      : hour24 < 12
      ? 'صبح'
      : hour24 < 16
      ? 'دوپہر'
      : hour24 < 20
      ? 'شام'
      : 'رات';
  const hourWords = integerToWords(hour12, 'ur');
  if (min === 0) return `${period} ${hourWords} بجے`;
  const minWords = integerToWords(min, 'ur');
  return `${period} ${hourWords} بج کر ${minWords} منٹ`;
}

export interface SpokenUnitMetadata {
  pattern: string;
  needs_native_review: boolean;
}

export const SINDHI_NUMBER_AND_UNIT_RULES: ReadonlyArray<SpokenUnitMetadata> = [
  { pattern: '°C -> ڊگري سينٽي گريڊ', needs_native_review: true },
  { pattern: '% -> سيڪڙو', needs_native_review: true },
  { pattern: 'm/s -> ميٽر في سيڪنڊ', needs_native_review: true },
  { pattern: 'km/h -> ڪلوميٽر في ڪلاڪ', needs_native_review: true },
  { pattern: 'kg/acre -> ڪلو في ايڪڙ', needs_native_review: true },
  { pattern: 'L/acre -> ليٽر في ايڪڙ', needs_native_review: true },
  { pattern: 'ml/L -> ملي ليٽر في ليٽر', needs_native_review: true },
  { pattern: 'mm -> ملي ميٽر', needs_native_review: true },
  { pattern: 'Rs./PKR -> رپيا', needs_native_review: true },
  { pattern: 'HH:MM -> صبح/منجهند/شام/رات جو X لڳي Y منٽ', needs_native_review: true },
  { pattern: 'Decimal X.Y -> X ڏهائي Y', needs_native_review: true },
  { pattern: 'Cardinal & ordinal 0..999,999,999 table', needs_native_review: true },
];
