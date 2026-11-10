import fs from 'node:fs';
import path from 'node:path';
import type { LexiconEntry } from './types';
import { getBundledLexiconEntries } from './lexicon-loader';

interface HotCacheState {
  mtimeMs: number;
  entries: LexiconEntry[];
}

let hotCache: HotCacheState | null = null;

function getLexiconFilePath(): string {
  return path.resolve(process.cwd(), 'data/voice/pronunciation-lexicon.json');
}

/**
 * Loads pronunciation-lexicon.json directly from disk when file mtime changes,
 * allowing new words or pronunciation fixes without code changes or restarts.
 */
export function loadHotPronunciationLexicon(): LexiconEntry[] {
  try {
    const filePath = getLexiconFilePath();
    if (!fs.existsSync(filePath)) {
      return getBundledLexiconEntries();
    }
    const stat = fs.statSync(filePath);
    if (hotCache && hotCache.mtimeMs === stat.mtimeMs) {
      return hotCache.entries;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { entries?: LexiconEntry[] };
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
      : getBundledLexiconEntries();
    hotCache = { mtimeMs: stat.mtimeMs, entries };
    return entries;
  } catch {
    return getBundledLexiconEntries();
  }
}

export function clearLexiconHotCacheForTests(): void {
  hotCache = null;
}

export function readServerEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const val = process.env[key];
    if (val && val.trim()) return val.trim();
  }
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const key of keys) {
        const m = content.match(new RegExp(`^${key}\\s*=\\s*([^\\r\\n#]+)`, 'm'));
        if (m && m[1]) {
          return m[1].trim().replace(/^['"]|['"]$/g, '');
        }
      }
    }
  } catch {
    // ignore on read-only serverless runtime
  }
  return undefined;
}
