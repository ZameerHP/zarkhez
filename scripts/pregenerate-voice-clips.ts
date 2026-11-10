import fs from 'node:fs';
import path from 'node:path';
import { toSpokenText } from '../lib/voice/spoken-normalizer';
import { loadHotPronunciationLexicon } from '../lib/voice/server-lexicon';
import {
  buildAudioCacheKey,
  synthesizeVoiceSpeech,
} from '../lib/voice/service';
import type { VoiceGender, VoiceLang } from '../lib/voice/types';

interface PregenItem {
  id: string;
  lang: VoiceLang;
  category: string;
  text: string;
}

async function run() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 40;
  const gendersArg = args.find((a) => a.startsWith('--genders='));
  const genders: VoiceGender[] = gendersArg
    ? (gendersArg.split('=')[1].split(',') as VoiceGender[])
    : ['female', 'male'];

  const lexicon = loadHotPronunciationLexicon();
  const urStrings = JSON.parse(
    fs.readFileSync(path.resolve('data/voice/spoken-strings-ur.json'), 'utf8')
  ) as { strings: Record<string, string> };
  const sdStrings = JSON.parse(
    fs.readFileSync(path.resolve('data/voice/spoken-strings-sd.json'), 'utf8')
  ) as { strings: Record<string, { text: string }> };
  const pregenSpec = JSON.parse(
    fs.readFileSync(path.resolve('data/voice/pregenerated-phrases.json'), 'utf8')
  ) as { items: PregenItem[] };

  const allItems: PregenItem[] = [...pregenSpec.items];
  for (const [k, text] of Object.entries(urStrings.strings)) {
    if (!text.includes('{')) {
      allItems.push({ id: `str_ur_${k}`, lang: 'ur', category: 'ui_string', text });
    }
  }
  for (const [k, obj] of Object.entries(sdStrings.strings)) {
    if (!obj.text.includes('{')) {
      allItems.push({ id: `str_sd_${k}`, lang: 'sd', category: 'ui_string', text: obj.text });
    }
  }

  const slice = allItems.slice(0, Math.max(1, limit));
  const manifest: Array<Record<string, unknown>> = [];

  console.log(`\nPre-generating ${slice.length} high-frequency phrases (${genders.join(', ')})...\n`);

  for (const item of slice) {
    for (const gender of genders) {
      const normalized = toSpokenText(item.text, item.lang, { lexiconEntries: lexicon });
      const cacheKey = buildAudioCacheKey({
        spokenText: normalized.spokenText,
        lang: item.lang,
        gender,
        speedRate: 0.9,
      });

      try {
        const res = await synthesizeVoiceSpeech({
          text: item.text,
          lang: item.lang,
          gender,
          speedMode: 'normal',
          clipId: item.id,
        });
        manifest.push({
          id: item.id,
          lang: item.lang,
          gender,
          cacheKey,
          provider: res.provider,
          cacheStatus: res.cacheStatus,
          bytes: res.audioBuffer.byteLength,
          latencyMs: res.latencyMs,
        });
        console.log(`  OK: [${item.lang}/${gender}] ${item.id} -> ${res.provider} (${res.cacheStatus}, ${res.audioBuffer.byteLength} B, ${res.latencyMs}ms)`);
      } catch (err) {
        console.warn(`  SKIP: [${item.lang}/${gender}] ${item.id}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  const outPath = path.resolve('data/voice/pregenerated-manifest.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalPlannedCatalog: allItems.length,
        generatedCount: manifest.length,
        clips: manifest,
      },
      null,
      2
    )
  );
  console.log(`\nManifest saved to data/voice/pregenerated-manifest.json (${manifest.length} entries).\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
