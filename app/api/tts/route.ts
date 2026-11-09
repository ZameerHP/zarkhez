import { NextRequest, NextResponse } from 'next/server';

/**
 * Neural Human-Like Urdu & English Text-to-Speech API Route (/api/tts)
 * Supports:
 * 1. Microsoft Azure Speech (ur-PK-UzmaNeural / ur-PK-AsadNeural) when key is configured
 * 2. High-speed parallel Google Neural/GTX fallback (ultra-reliable, 0 configuration, works everywhere)
 */

const ttsMemoryCache = new Map<string, { buffer: Uint8Array; timestamp: number }>();

const URDU_NUMBERS: Record<string, string> = {
  '0': 'صفر', '1': 'ایک', '2': 'دو', '3': 'تین', '4': 'چار', '5': 'پانچ',
  '6': 'چھ', '7': 'سات', '8': 'آٹھ', '9': 'نو', '10': 'دس',
  '11': 'گیارہ', '12': 'بارہ', '13': 'تیرہ', '14': 'چودہ', '15': 'پندرہ',
  '16': 'سولہ', '17': 'سترہ', '18': 'اٹھارہ', '19': 'انیس', '20': 'بیس',
  '21': 'اکیس', '22': 'بائیس', '23': 'تیئس', '24': 'چوبیس', '25': 'پچیس',
  '26': 'چھبیس', '27': 'ستائیس', '28': 'اٹھائیس', '29': 'انتیس', '30': 'تیس',
  '31': 'اکتیس', '32': 'بتیس', '33': 'تینتیس', '34': 'چونتیس', '35': 'پینتیس',
  '36': 'چھتیس', '37': 'سینتیس', '38': 'اڑتیس', '39': 'انتالیس', '40': 'چالیس',
  '45': 'پینتالیس', '50': 'پچاس', '55': 'پچپن', '60': 'سٹھ', '65': 'پینسٹھ',
  '70': 'ستر', '75': 'پچھتر', '80': 'اسی', '85': 'پچاسی', '90': 'نوے', '95': 'پچانوے', '100': 'سو',
  '150': 'ڈیڑھ سو', '200': 'دو سو', '250': 'ڈھائی سو', '500': 'پانچ سو', '1000': 'ایک ہزار',
  '2000': 'دو ہزار', '5000': 'پانچ ہزار', '10000': 'دس ہزار', '50000': 'پچاس ہزار', '100000': 'ایک لاکھ',
};

const PHRASE_PHONETIC_MAP: Array<[RegExp, string]> = [
  [/assalam\s*[-o\s]*alaikum/gi, 'السلام علیکم'],
  [/walaikum\s*[-o\s]*assalam/gi, 'وعلیکم السلام'],
  [/alhamdulillah/gi, 'الحمدللہ'],
  [/inshallah|insha\s*allah/gi, 'انشاءاللہ'],
  [/mashallah|masha\s*allah/gi, 'ماشاءاللہ'],
  [/allah\s+barkat\s+de/gi, 'اللہ برکت دے'],
  [/allah\s+hafiz/gi, 'اللہ حافظ'],
  [/khuda\s+hafiz/gi, 'خدا حافظ'],
  [/jazakallah/gi, 'جزاک اللہ'],
  [/subhanallah/gi, 'سبحان اللہ'],
  [/crown\s*[- ]*roots?/gi, 'کراؤن روٹس'],
  [/crown\s*[- ]*root\s+initiation/gi, 'کراؤن روٹ'],
  [/booting\s+stage/gi, 'بوٹنگ مرحلہ'],
  [/heading\s+stage/gi, 'سٹہ نکلنے کا مرحلہ'],
  [/tillering\s+stage/gi, 'شگوفے بننے کا مرحلہ'],
  [/white\s*fly/gi, 'سفید مکھی'],
  [/fall\s+army\s*worm/gi, 'فال آرمی ورم'],
  [/leaf\s+curl\s*virus/gi, 'پتا مروڑ وائرس'],
  [/leaf\s+curl/gi, 'پتوں کا مڑاؤ'],
  [/fertilizer\s+calculator/gi, 'کھاد کیلکولیٹر'],
  [/crop\s+calendar/gi, 'فصل کیلنڈر'],
  [/scan\s+leaf/gi, 'پتے کی اسکیننگ'],
  [/ai\s+advisor/gi, 'اے آئی مشیر'],
  [/weather\s+forecast/gi, 'موسم کی پیشگوئی'],
  [/spray\s+advisory/gi, 'سپرے مشورہ'],
];

const ROMAN_TO_URDU_WORDS: Record<string, string> = {
  // Common Conversational & Pronouns
  main: 'میں', mein: 'میں', me: 'میں', mera: 'میرا', meri: 'میری', mere: 'میرے',
  hum: 'ہم', hamara: 'ہمارا', hamari: 'ہماری', hamare: 'ہمارے',
  aap: 'آپ', ap: 'آپ', aapka: 'آپ کا', apka: 'آپ کا', aapki: 'آپ کی', apki: 'آپ کی', aapke: 'آپ کے', apke: 'آپ کے', aapko: 'آپ کو', apko: 'آپ کو',
  tum: 'تم', tumhara: 'تمہارا', tumhari: 'تمہاری', tumhare: 'تمہارے', tumko: 'تم کو',
  yeh: 'یہ', ye: 'یہ', is: 'اس', iska: 'اس کا', iski: 'اس کی', iske: 'اس کے', isko: 'اس کو', isse: 'اس سے', isme: 'اس میں',
  woh: 'وہ', wo: 'وہ', un: 'ان', unka: 'ان کا', unki: 'ان کی', unke: 'ان کے', unko: 'ان کو', unse: 'ان سے', unme: 'ان میں',
  use: 'اسے', usein: 'اسے', jise: 'جسے', jiska: 'جس کا', jiski: 'جس کی', jiske: 'جس کے', jisko: 'جس کو', jisme: 'جس میں', jisse: 'جس سے',
  jo: 'جو', jin: 'جن', jinka: 'جن کا', jinki: 'جن کی', jinke: 'جن کے', jinko: 'جن کو', jinse: 'جن سے',
  kya: 'کیا', kyun: 'کیوں', kyon: 'کیوں', kyu: 'کیوں', kab: 'کب', kahan: 'کہاں', kidhar: 'کدھر', kaise: 'کیسے', kese: 'کیسے',
  kis: 'کس', kiska: 'کس کا', kiski: 'کس کی', kiske: 'کس کے', kisko: 'کس کو', kisse: 'کس سے', kisme: 'کس میں',
  kitna: 'کتنا', kitni: 'کتنی', kitne: 'کتنے',
  kuch: 'کچھ', koi: 'کوئی', kisi: 'کسی', sab: 'سب', sabhi: 'سبھی', tamaam: 'تمام',
  kaun: 'کون', kon: 'کون', kaisa: 'کیسا', kaisi: 'کیسی',

  // Helping Verbs & State
  hai: 'ہے', hain: 'ہیں', he: 'ہے', hen: 'ہیں', hoon: 'ہوں', hun: 'ہوں', hon: 'ہوں',
  tha: 'تھا', thi: 'تھی', thay: 'تھے', the: 'تھے',
  hoga: 'ہوگا', hogi: 'ہوگی', honge: 'ہوں گے', hota: 'ہوتا', hoti: 'ہوتی', hote: 'ہوتے', ho: 'ہو',
  chahiye: 'چاہیے', chahye: 'چاہیے', chahiay: 'چاہیے',
  sakta: 'سکتا', sakti: 'سکتی', sakte: 'سکتے',
  raha: 'رہا', rahi: 'رہی', rahe: 'رہے', rahain: 'رہیں',

  // Conjunctions & Prepositions
  aur: 'اور', or: 'اور', ya: 'یا', lekin: 'لیکن', magar: 'مگر', balke: 'بلکہ',
  ka: 'کا', ki: 'کی', ke: 'کے', ko: 'کو', se: 'سے', par: 'پر', pe: 'پر', tak: 'تک', ne: 'نے',
  bhi: 'بھی', to: 'تو', toh: 'تو', hi: 'ہی', agar: 'اگر', jab: 'جب', tab: 'تب', jabke: 'جبکہ',
  kyunke: 'کیونکہ', kyunk: 'کیونکہ', kyuke: 'کیونکہ',
  taake: 'تاکہ', take: 'تاکہ', k: 'کہ', kehnay: 'کہنے',

  // Common Qualifiers & Adverbs
  theek: 'ٹھیک', thik: 'ٹھیک', bilkul: 'بالکل', balkul: 'بالکل',
  achha: 'اچھا', acha: 'اچھا', achi: 'اچھی', ache: 'اچھے', achay: 'اچھے',
  bohat: 'بہت', bohot: 'بہت', bahut: 'بہت', bht: 'بہت',
  zyada: 'زیادہ', ziyada: 'زیادہ', zada: 'زیادہ', kam: 'کم',
  thora: 'تھوڑا', thori: 'تھوڑی', thore: 'تھوڑے',
  zaroor: 'ضرور', zaroori: 'ضروری', zruri: 'ضروری',
  khasosan: 'خصوصاً', intehai: 'انتہائی', ahem: 'اہم', behtar: 'بہتر', lazmi: 'لازمی',
  pareshan: 'پریشان', pareshani: 'پریشانی', fikar: 'فکر', tension: 'ٹینشن',
  shukriya: 'شکریہ', meherbani: 'مہربانی', maazrat: 'معذرت',
  kisan: 'کسان', dost: 'دوست', bhai: 'بھائی', bhaiya: 'بھائی', sahib: 'صاحب', sahab: 'صاحب',
  zarkhez: 'زرخیز', advisor: 'مشیر', app: 'ایپ', settings: 'سیٹنگز',
  mobile: 'موبائل', phone: 'فون', message: 'میسج', voice: 'آواز', audio: 'آڈیو',
  scan: 'اسکین', scanning: 'اسکیننگ', photo: 'تصویر', tasweer: 'تصویر', pic: 'تصویر',
  digital: 'ڈیجیٹل', online: 'آن لائن', offline: 'آف لائن',

  // Actions & Verbs
  karna: 'کرنا', karein: 'کریں', karen: 'کریں', karo: 'کرو', karta: 'کرتا', karti: 'کرتی', karte: 'کرتے', kiya: 'کیا', kiye: 'کیے', karne: 'کرنے', karni: 'کرنی',
  lagana: 'لگانا', lagayein: 'لگائیں', lagaen: 'لگائیں', lagao: 'لگاؤ', lagata: 'لگاتا', lagati: 'لگاتی', lagate: 'لگاتے', lagaya: 'لگایا', lagayi: 'لگائی', lagaye: 'لگائے', lagane: 'لگانے',
  daalna: 'ڈالنا', daal: 'ڈال', dal: 'ڈال', daalein: 'ڈالیں', dalen: 'ڈالیں', dalo: 'ڈالو', dalta: 'ڈالتا', dalti: 'ڈالتی', dalte: 'ڈالتے', dala: 'ڈالا', dali: 'ڈالی', dale: 'ڈالے', dalne: 'ڈالنے',
  dena: 'دینا', dein: 'دیں', den: 'دیں', do: 'دو', deta: 'دیتا', deti: 'دیتی', dete: 'دیتے', diya: 'دیا', di: 'دی', diye: 'دیے', dene: 'دینے',
  lena: 'لینا', lein: 'لیں', len: 'لیں', lo: 'لو', leta: 'لیتا', leti: 'لیتی', lete: 'لیتے', liya: 'لیا', li: 'لی', liye: 'لیے', lene: 'لینے',
  banna: 'بننا', ban: 'بن', bante: 'بنتے', banti: 'بنتی', banta: 'بنتا', banein: 'بنیں', banayein: 'بنائیں', banaya: 'بنایا', banane: 'بنانے',
  rakhna: 'رکھنا', rakhein: 'رکھیں', rakhen: 'رکھیں', rakho: 'رکھو', rakhta: 'رکھتا', rakhti: 'رکھتی', rakhte: 'رکھتے', rakha: 'رکھا', rakhne: 'رکھنے',
  batana: 'بتانا', batayein: 'بتائیں', bataen: 'بتائیں', batao: 'بتاؤ', batata: 'بتاتا', batati: 'بتاتی', batate: 'بتاتے', bataya: 'بتایا', batane: 'بتانے',
  dekhna: 'دیکھنا', dekhein: 'دیکھیں', dekhen: 'دیکھیں', dekho: 'دیکھو', dekhta: 'دیکھتا', dekti: 'دیکھتی', dekte: 'دیکھتے', dekha: 'دیکھا', dekhne: 'دیکھنے',
  poochna: 'پوچھنا', poochein: 'پوچھیں', poochen: 'پوچھیں', poocho: 'پوچھو', poochta: 'پوچھتا', poochti: 'پوچھتی', poochte: 'پوچھتے', poochha: 'پوچھا',
  samajhna: 'سمجھنا', samjhein: 'سمجھیں', samjhen: 'سمجھیں', samjho: 'سمجھو', samjha: 'سمجھا', samajh: 'سمجھ',
  rokna: 'روکنا', rokein: 'روکیں', roken: 'روکیں', roko: 'روکو', roktay: 'روکتے',
  bachana: 'بچانا', bachayein: 'بچائیں', bachaen: 'بچائیں', bacha: 'بچا', bachao: 'بچاؤ',
  milna: 'ملنا', mile: 'ملے', milega: 'ملے گا', milegi: 'ملے گی', milenge: 'ملیں گے', milta: 'ملتا', milti: 'ملتی', milte: 'ملتے', mila: 'ملا',
  jaana: 'جانا', jayein: 'جائیں', jaen: 'جائیں', jao: 'جاؤ', jata: 'جاتا', jati: 'جاتی', jate: 'جاتے', gaya: 'گیا', gayi: 'گئی', gaye: 'گئے', jane: 'جانے',
  aana: 'آنا', aayein: 'آئیں', aaen: 'آئیں', aao: 'آؤ', aata: 'آتا', aati: 'آتی', aate: 'آتے', aaya: 'آیا', aayi: 'آئی', aaye: 'آئے', aane: 'آنے',
  shuru: 'شروع', shuroo: 'شروع', khatam: 'ختم', tayyar: 'تیار', tayari: 'تیاری',
  nazar: 'نظر', hamesha: 'ہمیشہ', foran: 'فوراً', jaldi: 'جلدی',
  ude: 'اڑے', udna: 'اڑنا', gir: 'گر', girna: 'گرنا', girne: 'گرنے', sookh: 'سوکھ', murjha: 'مرجھا',

  // Crops & Farming Vocabulary
  gandum: 'گندم', wheat: 'گندم', dhan: 'دھان', chawal: 'چاول', rice: 'دھان',
  kapas: 'کپاس', cotton: 'کپاس', kamad: 'کماد', ganna: 'گنا', sugarcane: 'کماد',
  makai: 'مکئی', maize: 'مکئی', corn: 'مکئی',
  tamatar: 'ٹماٹر', tomato: 'ٹماٹر', aloo: 'آلو', potato: 'آلو',
  mirch: 'مرچ', chili: 'مرچ', aam: 'آم', mango: 'آم',
  kinnow: 'کنو', citrus: 'مالٹا', malta: 'مالٹا', pyaz: 'پیاز', onion: 'پیاز',
  sarson: 'سرسوں', raya: 'رایا', canolla: 'کینولا', bajra: 'باجرہ', jowar: 'جوار',
  mung: 'مونگ', mash: 'ماش', chana: 'چنا', matar: 'مٹر',
  fasal: 'فصل', faslon: 'فصلوں', khet: 'کھیت', kheton: 'کھیتوں', zameen: 'زمین', mitti: 'مٹی',
  kheti: 'کھیتی', 'kheti-badi': 'کھیتی باڑی',
  pani: 'پانی', water: 'پانی', aabpashi: 'آبپاشی', irrigation: 'آبپاشی', watar: 'وتر', sooka: 'سوکا',
  khad: 'کھاد', khadon: 'کھادوں', fertilizer: 'کھاد', bori: 'بوری', boriyan: 'بوریاں', bag: 'بوری', bags: 'بوریاں',
  urea: 'یوریا', dap: 'ڈی اے پی', potash: 'پوٹاش', sop: 'ایس او پی', mop: 'ایم او پی',
  zinc: 'زنک', boron: 'بوران', sulfur: 'سلفر', sulphur: 'سلفر', nitrogen: 'نائٹروجن', phosphorus: 'فاسفورس',
  spray: 'سپرے', nozzle: 'نوزل', tanki: 'ٹنکی', tank: 'ٹنکی', mask: 'ماسک', gloves: 'دستانے',
  beej: 'بیج', bijai: 'بجائی', seed: 'بیج', seeds: 'بیج', sowing: 'بجائی',
  patta: 'پتا', patte: 'پتے', paton: 'پتوں', leaf: 'پتا', leaves: 'پتے',
  jar: 'جڑ', jarein: 'جڑیں', root: 'جڑ', roots: 'جڑیں',
  tana: 'تنا', tane: 'تنے', stem: 'تنا',
  phool: 'پھول', flower: 'پھول', phal: 'پھل', fruit: 'پھل',
  sitta: 'سٹہ', sitte: 'سٹے', ear: 'سٹہ', panicle: 'سٹہ',
  poda: 'پودا', poday: 'پودے', pode: 'پودے', podon: 'پودوں', plant: 'پودا', plants: 'پودے',
  pan: 'پن',
  booting: 'بوٹنگ', heading: 'سٹہ نکلنا', tillering: 'شگوفے',
  barhotri: 'بڑھوتری', paidawar: 'پیداوار', yield: 'پیداوار', munafa: 'منافع', kharcha: 'خرچہ',
  lodging: 'پودے کا گرنا',

  // Diseases & Pests
  bimari: 'بیماری', bimariyan: 'بیماریاں', disease: 'بیماری',
  keera: 'کیڑا', keeray: 'کیڑے', pest: 'کیڑا', pests: 'کیڑے', insects: 'کیڑے',
  sundi: 'سنڈی', sundiyan: 'سنڈیاں', caterpillar: 'سنڈی',
  makhi: 'مکھی', fly: 'مکھی',
  teela: 'تیلا', teli: 'تیلا', aphid: 'تیلا', aphids: 'تیلا', jassid: 'جیسڈ', thrips: 'تھرپس',
  phaphondi: 'پھپھوندی', fungus: 'پھپھوندی', fungal: 'پھپھوندی',
  blast: 'بلاسٹ', blight: 'جھلساؤ', jhulsao: 'جھلساؤ', rust: 'رسٹ', kangi: 'کنگی',
  peela: 'پیلا', peeli: 'پیلی', peelay: 'پیلے', yellow: 'پیلا', yellowing: 'پیلا پن',
  sukr: 'سکڑ', sukur: 'سکڑ', curl: 'مڑاؤ', curling: 'مڑاؤ',
  dhabba: 'دھبہ', dhabbe: 'دھبے', spot: 'دھبہ', spots: 'دھبے', lesions: 'دھبے',
  fungicide: 'فنجی سائیڈ', insecticide: 'کیڑے مار دوا', weedicide: 'جڑی بوٹی مار دوا',
  pesticide: 'زرعی زہر', zehar: 'زہر', dawa: 'دوا', dawai: 'دوائی', dawaiyaan: 'دوائیاں', medicine: 'دوائی',

  // Weather & Time
  hawa: 'ہوا', wind: 'ہوا', barish: 'بارش', rain: 'بارش',
  dhoop: 'دھوپ', sun: 'دھوپ', mausam: 'موسم', weather: 'موسم',
  sardi: 'سردی', cold: 'سردی', garmi: 'گرمی', heat: 'گرمی',
  nami: 'نمی', humidity: 'نمی', shabnam: 'شبنم', dew: 'شبنم',
  subah: 'صبح', morning: 'صبح', dophar: 'دوپہر', dopahar: 'دوپہر', noon: 'دوپہر',
  shaam: 'شام', sham: 'شام', evening: 'شام', raat: 'رات', night: 'رات',
  waqt: 'وقت', time: 'وقت', doran: 'دوران',
  din: 'دن', day: 'دن', days: 'دن',
  hafte: 'ہفتے', hafta: 'ہفتہ', week: 'ہفتہ', weeks: 'ہفتے',
  mahina: 'مہینہ', maheene: 'مہینے', month: 'مہینہ', months: 'مہینے',
  saal: 'سال', year: 'سال',
  ghante: 'گھنٹے', ghanta: 'گھنٹہ', hours: 'گھنٹے',
  pehla: 'پہلا', pehli: 'پہلی', pehle: 'پہلے', first: 'پہلا',
  doosra: 'دوسرا', doosri: 'دوسری', doosre: 'دوسرے', second: 'دوسرا',
  teesra: 'تیسرا', teesri: 'تیسری', teesre: 'تیسرے', third: 'تیسرا',
  baad: 'بعد', after: 'بعد', sath: 'ساتھ', saath: 'ساتھ', with: 'ساتھ',
  bahar: 'باہر', andar: 'اندر', ooper: 'اوپر', upar: 'اوپر', neeche: 'نیچے', nichay: 'نیچے',

  // Units & Measures
  acre: 'ایکڑ', ekar: 'ایکڑ', ekarr: 'ایکڑ',
  foot: 'فٹ', feet: 'فٹ', inch: 'انچ', inches: 'انچ',
  litr: 'لیٹر', liter: 'لیٹر', litre: 'لیٹر', liters: 'لیٹر', ml: 'ملی لیٹر',
  gram: 'گرام', grams: 'گرام', kg: 'کلوگرام', kgs: 'کلوگرام', kilo: 'کلو',
  split: 'حصہ', dose: 'مقدار',
  percent: 'فیصد', percentage: 'فیصد',
  rupee: 'روپیہ', rupees: 'روپے', rs: 'روپے', pkr: 'روپے',
};

const PHONETIC_RULES: Array<[RegExp, string]> = [
  [/scan/gi, 'اسکین'],
  [/kh/gi, 'خ'], [/gh/gi, 'غ'], [/sh/gi, 'ش'], [/ch/gi, 'چ'],
  [/th/gi, 'تھ'], [/ph/gi, 'پھ'], [/dh/gi, 'دھ'], [/bh/gi, 'بھ'],
  [/jh/gi, 'جھ'], [/zh/gi, 'ژ'], [/sc/gi, 'سک'],
  [/aa/gi, 'آ'], [/ee/gi, 'ی'], [/oo/gi, 'و'], [/ai/gi, 'ائے'],
  [/b/gi, 'ب'], [/p/gi, 'پ'], [/t/gi, 'ت'], [/j/gi, 'ج'],
  [/c/gi, 'ک'], [/d/gi, 'د'], [/r/gi, 'ر'], [/z/gi, 'ز'],
  [/s/gi, 'س'], [/f/gi, 'ف'], [/q/gi, 'ق'], [/k/gi, 'ک'],
  [/g/gi, 'گ'], [/l/gi, 'ل'], [/m/gi, 'م'], [/n/gi, 'ن'],
  [/w|v/gi, 'و'], [/h/gi, 'ہ'], [/y/gi, 'ی'], [/x/gi, 'کس'],
  [/a/gi, 'ا'], [/e/gi, 'ے'], [/i/gi, 'ی'], [/o/gi, 'و'], [/u/gi, 'و'],
];

function phoneticUrduWord(word: string): string {
  let w = word.toLowerCase();
  for (const [rgx, rep] of PHONETIC_RULES) {
    w = w.replace(rgx, rep);
  }
  return w;
}

function romanUrduToSpokenUrduScript(text: string): string {
  // If text already contains significant Urdu script, return directly
  if (/[\u0600-\u06FF]{6,}/.test(text)) {
    return text;
  }

  let out = text;
  for (const [rgx, rep] of PHRASE_PHONETIC_MAP) {
    out = out.replace(rgx, rep);
  }

  // Replace units like m/s, %, Rs.
  out = out.replace(/(\d+)\s*m\/s/gi, '$1 میٹر فی سیکنڈ');
  out = out.replace(/(\d+)\s*%/gi, '$1 فیصد');
  out = out.replace(/(\d+)\s*c\b/gi, '$1 ڈگری سینٹی گریڈ');
  out = out.replace(/(\d+)\s*°c/gi, '$1 ڈگری سینٹی گریڈ');
  out = out.replace(/\bRs\.?\s*(\d+)/gi, '$1 روپے');
  out = out.replace(/\bPKR\s*(\d+)/gi, '$1 روپے');

  // Replace numbers with Urdu words
  out = out.replace(/\b(\d+)\b/g, (match) => URDU_NUMBERS[match] || match);

  // Replace words
  out = out
    .split(/(\b[\w'-]+\b)/)
    .map((token) => {
      const lower = token.toLowerCase();
      if (ROMAN_TO_URDU_WORDS[lower]) return ROMAN_TO_URDU_WORDS[lower];
      // If pure numbers, spaces, punctuation or already Urdu script, keep
      if (/^[\d\s،۔!?:.,()'"-]+$/.test(token) || /[\u0600-\u06FF]/.test(token)) {
        return token;
      }
      // Unmapped Roman token or loanword: phonetic fallback so zero Latin letters reach the Urdu TTS engine
      return phoneticUrduWord(token);
    })
    .join('');

  return out.replace(/\s+/g, ' ').trim();
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanTextForSpeech(text: string, lang: 'ur' | 'en'): string {
  let cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_~`>|[\]()•]/g, ' ')
    .replace(/\bRs\.\s*/gi, lang === 'ur' ? 'روپے ' : 'Rupees ')
    .replace(/\bPKR\b/gi, lang === 'ur' ? 'روپے ' : 'Rupees ')
    .replace(/(\d+)\s*%/g, lang === 'ur' ? '$1 فیصد ' : '$1 percent ')
    .replace(/(?:^|\n)\s*(\d+)\.\s+/g, lang === 'ur' ? ' نمبر $1: ' : ' Step $1: ')
    .replace(/\s+/g, ' ')
    .trim();

  if (lang === 'ur') {
    cleaned = romanUrduToSpokenUrduScript(cleaned);
  }
  return cleaned;
}

function splitIntoSpeakableChunks(
  text: string,
  lang: 'ur' | 'en',
  maxLen = 120
): string[] {
  const cleaned = cleanTextForSpeech(text, lang);
  if (!cleaned) return [];

  // Split by sentence delimiters
  const sentences = cleaned.split(/(?<=[۔.!?،,\n])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length <= maxLen) {
      current = (current + ' ' + sentence).trim();
    } else {
      if (current) chunks.push(current);
      if (sentence.length <= maxLen) {
        current = sentence.trim();
      } else {
        const words = sentence.split(' ');
        let temp = '';
        for (const w of words) {
          if ((temp + ' ' + w).trim().length <= maxLen) {
            temp = (temp + ' ' + w).trim();
          } else {
            if (temp) chunks.push(temp);
            temp = w;
          }
        }
        current = temp;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 10);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const text = (searchParams.get('text') || '').trim().slice(0, 900);
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ur';
  const voice = searchParams.get('voice') || (lang === 'ur' ? 'ur-PK-UzmaNeural' : 'en-US-JennyNeural');

  if (!text) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  const cacheKey = `${lang}:${voice}:${text}`;
  const cached = ttsMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 86400_000) {
    return new Response(Buffer.from(cached.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  }

  // 1. Try Azure Speech Service if key is provided
  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';

  if (azureKey) {
    try {
      const azureUrl = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const ssml = `<speak version='1.0' xml:lang='${lang === 'ur' ? 'ur-PK' : 'en-US'}'>
        <voice xml:lang='${lang === 'ur' ? 'ur-PK' : 'en-US'}' name='${voice}'>
          ${escapeXml(cleanTextForSpeech(text, lang))}
        </voice>
      </speak>`;

      const res = await fetch(azureUrl, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          'User-Agent': 'Zarkhez-TTS',
        },
        body: ssml,
      });

      if (res.ok) {
        const audioBuf = await res.arrayBuffer();
        const uint8 = new Uint8Array(audioBuf);
        ttsMemoryCache.set(cacheKey, { buffer: uint8, timestamp: Date.now() });

        return new Response(Buffer.from(uint8), {
          status: 200,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
    } catch (azureErr) {
      console.warn('[Azure TTS] Fallback to fast parallel engine:', azureErr);
    }
  }

  // 2. High-speed Parallel Google Voice Stream (Fast, Warm, Ultra-Reliable)
  const chunks = splitIntoSpeakableChunks(text, lang, 100);
  if (chunks.length === 0) {
    return NextResponse.json({ error: 'Empty text' }, { status: 400 });
  }

  try {
    const chunkPromises = chunks.map(async (chunk) => {
      const ttsUrl = new URL('https://translate.google.com/translate_tts');
      ttsUrl.searchParams.set('ie', 'UTF-8');
      ttsUrl.searchParams.set('tl', lang);
      ttsUrl.searchParams.set('client', 'gtx');
      ttsUrl.searchParams.set('q', chunk);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);

      try {
        const res = await fetch(ttsUrl.toString(), {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
            Accept: '*/*',
          },
          signal: controller.signal,
        });

        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 64) {
            return buf;
          }
        }
      } catch {
        // ignore chunk error
      } finally {
        clearTimeout(timeout);
      }
      return null;
    });

    const buffers = (await Promise.all(chunkPromises)).filter(
      (b): b is ArrayBuffer => b !== null
    );

    if (buffers.length === 0) {
      return NextResponse.json(
        { error: 'TTS upstream unavailable' },
        { status: 502 }
      );
    }

    const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of buffers) {
      combined.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    }

    if (ttsMemoryCache.size > 250) {
      ttsMemoryCache.clear();
    }
    ttsMemoryCache.set(cacheKey, { buffer: combined, timestamp: Date.now() });

    return new Response(Buffer.from(combined), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (err) {
    console.error('[TTS API error]:', err);
    return NextResponse.json(
      { error: 'Failed to synthesize speech' },
      { status: 502 }
    );
  }
}
