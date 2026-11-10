import fs from 'node:fs';
import path from 'node:path';
import { toSpokenText } from '../lib/voice/spoken-normalizer';
import { loadHotPronunciationLexicon } from '../lib/voice/server-lexicon';
import { synthesizeVoiceSpeech } from '../lib/voice/service';
import { transcribeFarmAudio } from '../lib/voice/stt';
import type { VoiceLang } from '../lib/voice/types';

interface TestPhrase {
  id: string;
  category: string;
  text: string;
  needs_native_review?: boolean;
}

function normalizeForWer(s: string): string[] {
  return s
    .replace(/[۔.!?؟،,؛;:"'«»“”()[\]\-]/g, ' ')
    .replace(/[\u064B-\u065F\u0670]/g, '') // strip optional Arabic diacritics
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
}

function computeWordErrorRate(reference: string, hypothesis: string): {
  wer: number;
  edits: number;
  refWords: number;
} {
  const ref = normalizeForWer(reference);
  const hyp = normalizeForWer(hypothesis);
  const m = ref.length;
  const n = hyp.length;
  if (m === 0) return { wer: n === 0 ? 0 : 1, edits: n, refWords: 0 };

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const edits = dp[m][n];
  return { wer: edits / m, edits, refWords: m };
}

async function evaluateBatch(lang: VoiceLang, items: TestPhrase[], limit: number) {
  const lexicon = loadHotPronunciationLexicon();
  const sample = items.slice(0, limit);
  const results: Array<{
    id: string;
    category: string;
    spokenTarget: string;
    sttTranscript: string;
    wer: number;
    ttsMs: number;
    sttMs: number;
    provider: string;
  }> = [];

  for (const item of sample) {
    try {
      const normalized = toSpokenText(item.text, lang, { lexiconEntries: lexicon });
      const ttsRes = await synthesizeVoiceSpeech({
        text: item.text,
        lang,
        gender: 'female',
        speedMode: 'normal',
        skipCache: true,
      });
      const sttRes = await transcribeFarmAudio({
        audioBase64: Buffer.from(ttsRes.audioBuffer).toString('base64'),
        mimeType: ttsRes.contentType,
        lang,
      });

      const normalizedHyp = toSpokenText(sttRes.transcript, lang, {
        lexiconEntries: lexicon,
        maxWordsPerSentence: 40,
      }).spokenText;

      const metric = computeWordErrorRate(normalized.spokenText, normalizedHyp || sttRes.transcript);
      results.push({
        id: item.id,
        category: item.category,
        spokenTarget: normalized.spokenText,
        sttTranscript: sttRes.transcript,
        wer: Number((metric.wer * 100).toFixed(1)),
        ttsMs: ttsRes.latencyMs,
        sttMs: sttRes.latencyMs,
        provider: ttsRes.provider,
      });
      console.log(
        `  [${lang}] ${item.id} (${item.category}) | WER=${(metric.wer * 100).toFixed(1)}% | TTS=${ttsRes.latencyMs}ms | STT=${sttRes.latencyMs}ms`
      );
      await new Promise((r) => setTimeout(r, 1200));
    } catch (err) {
      console.warn(
        `  [${lang}] ${item.id} SKIP (${err instanceof Error ? err.message : 'rate_limited'})`
      );
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  const avgWer =
    results.reduce((acc, r) => acc + r.wer, 0) / Math.max(1, results.length);
  const avgTtsMs =
    results.reduce((acc, r) => acc + r.ttsMs, 0) / Math.max(1, results.length);

  return {
    lang,
    testedCount: results.length,
    averageWerPct: Number(avgWer.toFixed(1)),
    averageTtsMs: Math.round(avgTtsMs),
    items: results,
  };
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limitPerLang = limitArg ? Number(limitArg.split('=')[1]) : 5;

  const testSet = JSON.parse(
    fs.readFileSync(path.resolve('data/voice/voice-test-set.json'), 'utf8')
  ) as { urdu: TestPhrase[]; sindhi: TestPhrase[] };

  console.log(`\n=== Zarkhez Voice Round-Trip TTS -> STT Evaluation (${limitPerLang} phrases/lang) ===\n`);
  const urReport = await evaluateBatch('ur', testSet.urdu, limitPerLang);
  const sdReport = await evaluateBatch('sd', testSet.sindhi, limitPerLang);

  const report = {
    generatedAt: new Date().toISOString(),
    urdu: urReport,
    sindhi: sdReport,
  };

  fs.writeFileSync(
    path.resolve('data/voice/last-wer-report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
  console.log('\nSummary:');
  console.log(`  Urdu (ur-PK):   Avg WER = ${urReport.averageWerPct}% | Avg TTS = ${urReport.averageTtsMs}ms`);
  console.log(`  Sindhi (sd-PK): Avg WER = ${sdReport.averageWerPct}% | Avg TTS = ${sdReport.averageTtsMs}ms\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
