import type { ScanErrorCategory } from './schemas';

export type CustomerErrorContext =
  | 'scan'
  | 'chat'
  | 'weather'
  | 'tts'
  | 'auth'
  | 'database'
  | 'general';

const CLIENT_UNSAFE_DISPLAY_PATTERNS: RegExp[] = [
  /\b(?:zod|invalid_type|unrecognized_keys)\b/i,
  /\bHTTP\s*[45]\d{2}\b|\bstatus\s*(?:code)?\s*[45]\d{2}\b/i,
  /\b(?:SyntaxError|TypeError|ReferenceError|FetchError|AbortError|ENOTFOUND|ECONNREFUSED|ETIMEDOUT)\b/i,
  /unexpected token|expected double-quoted|json at position|is not valid json/i,
  /\b(?:pg_catalog|postgrest|row-level security|violates constraint)\b/i,
  /at\s+[A-Za-z0-9_$.<>]+\s*\([^)]+:\d+:\d+\)/,
  /\bgemini\b|جیمنائی|جیمنی|جيمنائي/i,
];

export function getCustomerErrorMessage(
  category: ScanErrorCategory,
  context: CustomerErrorContext = 'scan'
): { en: string; ur: string } {
  if (context === 'database') {
    return {
      en: "Your information couldn't be saved right now. Please try again.",
      ur: 'آپ کی معلومات ابھی محفوظ نہیں ہو سکیں۔ براہِ کرم دوبارہ کوشش کریں۔',
    };
  }

  if (context === 'weather') {
    return {
      en: 'Weather details are temporarily unavailable. Please try again shortly.',
      ur: 'موسم کی تفصیلات اس وقت دستیاب نہیں ہیں۔ براہِ کرم کچھ دیر بعد دوبارہ کوشش کریں۔',
    };
  }

  if (context === 'tts') {
    return {
      en: 'Voice summary is unavailable right now; the written text is ready below.',
      ur: 'اس وقت آواز نہیں چل سکی، لیکن مکمل تحریری معلومات نیچے موجود ہیں۔',
    };
  }

  if (context === 'chat') {
    return {
      en: 'The advisor is temporarily busy. Please ask your question again.',
      ur: 'زرعی مشیر اس وقت مصروف ہے۔ براہِ کرم اپنا سوال دوبارہ پوچھیں۔',
    };
  }

  if (context === 'auth') {
    return {
      en: 'We could not sign you in right now. Please check your details and try again.',
      ur: 'اس وقت لاگ ان مکمل نہیں ہو سکا۔ براہِ کرم اپنی معلومات چیک کر کے دوبارہ کوشش کریں۔',
    };
  }

  switch (category) {
    case 'network_or_timeout':
      return {
        en: 'Connection interrupted. Please check your internet connection and tap Retry.',
        ur: 'انٹرنیٹ کنکشن میں رکاوٹ آ گئی ہے۔ انٹرنیٹ چیک کر کے دوبارہ کوشش کریں۔',
      };
    case 'rate_limited':
      return {
        en: 'AI service is temporarily busy. Wait a moment and tap Retry.',
        ur: 'اس وقت بہت زیادہ لوگ استعمال کر رہے ہیں۔ کچھ سیکنڈ بعد دوبارہ کوشش کریں۔',
      };
    case 'quota_exhausted':
      return {
        en: 'AI scanning is temporarily unavailable. Your scan can continue using an offline assessment below.',
        ur: 'آن لائن معائنہ اس وقت دستیاب نہیں ہے۔ آپ نیچے سے آف لائن ابتدائی جائزہ دیکھ سکتے ہیں۔',
      };
    case 'invalid_image_input':
      return {
        en: "We couldn't process this picture. Please upload another clear photo of your plant.",
        ur: 'ہم یہ تصویر پڑھ نہیں سکے۔ براہِ کرم پودے کی دوسری واضح تصویر لگائیں۔',
      };
    case 'permanent_config_error':
      return {
        en: 'This service is temporarily unavailable. Please try again later.',
        ur: 'یہ سروس عارضی طور پر دستیاب نہیں ہے۔ براہِ کرم کچھ دیر بعد کوشش کریں۔',
      };
    case 'schema_validation_failed':
    case 'malformed_ai_response':
      return {
        en: "We couldn't complete the plant scan. Your photo is preserved — please try again.",
        ur: 'پودے کا معائنہ مکمل نہیں ہو سکا۔ آپ کی تصویر محفوظ ہے — براہِ کرم دوبارہ کوشش کریں۔',
      };
    case 'temporary_service_failure':
    default:
      return {
        en: 'Something went wrong. Please try again.',
        ur: 'کچھ عارضی مسئلہ پیش آیا ہے۔ براہِ کرم دوبارہ کوشش کریں۔',
      };
  }
}

export function sanitizeCustomerText(
  candidate: string | undefined | null,
  lang: 'en' | 'ur',
  fallbackCategory: ScanErrorCategory = 'temporary_service_failure',
  context: CustomerErrorContext = 'scan'
): string {
  const safeFallback = getCustomerErrorMessage(fallbackCategory, context)[lang];
  if (!candidate || typeof candidate !== 'string') {
    return safeFallback;
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    return safeFallback;
  }
  const unsafe = CLIENT_UNSAFE_DISPLAY_PATTERNS.some((rx) => {
    rx.lastIndex = 0;
    return rx.test(trimmed);
  });
  return unsafe ? safeFallback : trimmed;
}
