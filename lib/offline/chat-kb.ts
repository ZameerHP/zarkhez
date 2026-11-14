'use client';

import type { VoiceLang } from '@/lib/voice';
import {
  getAvailableOfflineGuides,
  normalizeIndicArabicText,
  searchOfflineGuides,
} from './knowledge-base';
import { getOfflineFertilizerSchedule } from './fertilizer-guide';
import { searchOfflineSchemes } from './schemes';
import { idbGetAll, idbPruneOldest, idbPut, OFFLINE_STORES } from './db';

/**
 * ZARKHEZ Offline Farming Advisor — Local Knowledge Base Engine
 *
 * Honesty & Architecture Compliance (Part 5):
 * - Clearly distinguishes non-generative local knowledge-base retrieval from online generative AI.
 * - Covers cultivation, crop diseases, fertilizers, pests, irrigation, soil reclamation,
 *   sowing/harvest, pesticide safety, and verified government schemes across EN / UR / SD.
 * - Never fabricates market prices or unverified agrochemical dosages.
 */

export interface OfflineChatReply {
  answerText: string;
  sourceType: 'offline_knowledge_base';
  matchedTitle: string;
  sourceAttribution: string;
}

export interface StoredChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  voiceLang: VoiceLang;
  sourceType: 'cloud_gemini' | 'offline_knowledge_base';
  updatedAt: number;
}

export async function saveOfflineChatTurn(turn: StoredChatTurn): Promise<boolean> {
  const ok = await idbPut(OFFLINE_STORES.CHAT_HISTORY, turn);
  if (ok) {
    await idbPruneOldest(OFFLINE_STORES.CHAT_HISTORY, 60, 'updatedAt').catch(() => 0);
  }
  return ok;
}

export async function getOfflineChatHistory(limit = 30): Promise<StoredChatTurn[]> {
  const rows = await idbGetAll<StoredChatTurn>(OFFLINE_STORES.CHAT_HISTORY);
  return rows.sort((a, b) => a.updatedAt - b.updatedAt).slice(-limit);
}

const FERTILIZER_CROP_KEYWORDS: Array<{ cropKey: string; tokens: string[] }> = [
  { cropKey: 'wheat', tokens: ['wheat', 'gandum', 'گندم', 'ڪڻڪ'] },
  { cropKey: 'rice', tokens: ['rice', 'paddy', 'dhan', 'chawal', 'چاول', 'دھان', 'ساریون', 'ساريون'] },
  { cropKey: 'cotton', tokens: ['cotton', 'kapas', 'کپاس', 'وونئڻ'] },
  { cropKey: 'sugarcane', tokens: ['sugarcane', 'ganna', 'kamad', 'کماد', 'گنا', 'ڪمند'] },
  { cropKey: 'maize', tokens: ['maize', 'corn', 'makai', 'مکئی', 'مڪئي'] },
  { cropKey: 'tomato', tokens: ['tomato', 'tamatar', 'ٹماٹر', 'ٽماٽر'] },
];

export async function answerOfflineChatQuestion(
  question: string,
  lang: VoiceLang
): Promise<OfflineChatReply> {
  const normalized = normalizeIndicArabicText(question.trim());

  // 1. Check government scheme queries offline first
  if (
    /(scheme|card|kissan|kisan|hari|tractor|loan|subsidy|solar|ztbl|govt|government|اسکیم|کارڈ|قرض|سبسڈی|ٹریکٹر|سولر|اسڪیم|ڪارڊ|قرض|ہاری)/i.test(
      normalized
    )
  ) {
    const schemeHits = await searchOfflineSchemes(question);
    if (schemeHits.length > 0) {
      const top = schemeHits[0];
      const header =
        lang === 'sd'
          ? `[آف لائن سرڪاري اسڪيم گائيڊ]\n${top.title.sd || top.title.ur}: ${top.summary.sd || top.summary.ur}`
          : lang === 'ur'
          ? `[آف لائن زرعی معلومات — سرکاری اسکیم]\n${top.title.ur}: ${top.summary.ur}`
          : `[Offline Farming Guide — Verified Scheme KB]\n${top.title.en}: ${top.summary.en}`;
      const elig =
        lang === 'ur' || lang === 'sd'
          ? top.eligibility.ur.slice(0, 3).map((s) => `• ${s}`).join('\n')
          : top.eligibility.en.slice(0, 3).map((s) => `• ${s}`).join('\n');
      const footer =
        lang === 'sd'
          ? `وڌيڪ تصديق لاءِ سرڪاري ويب سائيٽ (${top.officialPortal}) ڏسو.`
          : lang === 'ur'
          ? `آفیشل پورٹل (${top.officialPortal}) پر آخری تاریخ اور آن لائن تصدیق ضرور کریں۔`
          : `Verify current application dates on the official portal: ${top.officialPortal}.`;
      return {
        answerText: `${header}\n\n${elig}\n\n${footer}`,
        sourceType: 'offline_knowledge_base',
        matchedTitle: top.title[lang === 'en' ? 'en' : 'ur'],
        sourceAttribution: top.department,
      };
    }
  }

  // 2. Check crop fertilizer split timing queries
  if (/(fertilizer|urea|dap|potash|sop|zinc|bhad|bhaan|khad|کھاد|یوریا|ڈی اے پی|پوٹاش|ڀاڻ|یوریا)/i.test(normalized)) {
    const detectedCrop =
      FERTILIZER_CROP_KEYWORDS.find((c) =>
        c.tokens.some((tok) => normalized.includes(normalizeIndicArabicText(tok)))
      )?.cropKey || 'wheat';
    const schedule = getOfflineFertilizerSchedule(detectedCrop);
    const intro =
      lang === 'sd'
        ? `[آف لائن ڀاڻ گائيڊ — ${detectedCrop}]`
        : lang === 'ur'
        ? `[آف لائن زرعی گائیڈ (بغیر AI جنریشن) — کھاد شیڈول (${detectedCrop})]`
        : `[Offline Farming Guide (Local KB, non-generative) — Fertilizer Stages for ${detectedCrop}]`;
    const body = schedule.stages
      .map((st) =>
        lang === 'en'
          ? `• ${st.stageEn} (${st.timingEn}): ${st.guidanceEn}`
          : `• ${st.stageUr} (${st.timingUr}): ${st.guidanceUr}`
      )
      .join('\n');
    const note =
      lang === 'en'
        ? `Note: Use Zarkhez Fertilizer Calculator for exact kg/acre bags.`
        : `نوٹ: فی ایکڑ بوریوں کے درست حساب کے لیے کھاد کیلکولیٹر استعمال کریں۔`;

    return {
      answerText: `${intro}\n\n${body}\n\n${note}`,
      sourceType: 'offline_knowledge_base',
      matchedTitle: `Fertilizer Stage Guide (${detectedCrop})`,
      sourceAttribution: 'Zarkhez Verified Agronomy KB',
    };
  }

  // 3. Search curated offline agricultural guides
  const guides = await getAvailableOfflineGuides();
  const hits = searchOfflineGuides(question, guides, 2);

  if (hits.length > 0) {
    const primary = hits[0].guide;
    const targetKey: 'en' | 'ur' | 'sd' =
      lang === 'sd' ? 'sd' : lang === 'ur' ? 'ur' : 'en';

    const title = primary.title[targetKey] || primary.title.ur || primary.title.en;
    const summary = primary.summary[targetKey] || primary.summary.ur || primary.summary.en;
    const steps =
      primary.steps[targetKey] && primary.steps[targetKey]!.length > 0
        ? primary.steps[targetKey]!
        : primary.steps.ur.length > 0
        ? primary.steps.ur
        : primary.steps.en;

    const badge =
      lang === 'sd'
        ? 'آف لائن زرعي گائيڊ (محفوظ معلومات):'
        : lang === 'ur'
        ? 'آف لائن زرعی گائیڈ (محفوظ معلومات، لائیو AI نہیں):'
        : 'Offline Farming Guide (Local KB — non-generative):';

    const formattedSteps = steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
    const attribution =
      lang === 'en'
        ? `Source: ${primary.source}. Connect online for live AI conversation.`
        : `ماخذ: ${primary.source}۔ لائیو AI مشورے کے لیے انٹرنیٹ سے منسلک ہوں۔`;

    return {
      answerText: `${badge}\n${title}\n${summary}\n\n${formattedSteps}\n\n${attribution}`,
      sourceType: 'offline_knowledge_base',
      matchedTitle: title,
      sourceAttribution: primary.source,
    };
  }

  // 4. Honest unsupported-topic fallback when query does not match offline KB cleanly
  const fallbackMsg =
    lang === 'sd'
      ? 'آف لائن زرعي گائيڊ ۾ هن خاص سوال جو پورو جواب محفوظ ناهي. مھرباني ڪري ڪڻڪ، ساريون، وونئڻ، ڪمند، مڪئي، ٽماٽر، ڀاڻ، اسپري حفاظت يا سرڪاري اسڪيمن بابت پڇو، يا لائيواي آءِ لاءِ انٽرنيٽ سان ڳنڍيو.'
      : lang === 'ur'
      ? 'آف لائن زرعی گائیڈ میں اس مخصوص سوال کا مکمل جواب موجود نہیں ہے۔ آپ گندم، دھان، کپاس، گنا، مکئی، ٹماٹر، کھاد، محفوظ سپرے، کلر زمین یا سرکاری اسکیموں کے بارے میں پوچھ سکتے ہیں، یا لائیو AI مشورے کے لیے انٹرنیٹ آن کریں۔'
      : 'Offline Knowledge Base did not find a close match for that exact question (remember live generative AI requires internet). Try asking about Wheat, Rice, Cotton, Sugarcane, Maize, Tomato, Fertilizer, Safe Spraying, Soil Salinity, Grain Storage, or Govt Schemes.';

  return {
    answerText: fallbackMsg,
    sourceType: 'offline_knowledge_base',
    matchedTitle: 'Offline KB Boundary',
    sourceAttribution: 'Zarkhez Local KB',
  };
}
