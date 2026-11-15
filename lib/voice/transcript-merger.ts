/**
 * Pure Transcript Sequencing, Overlap Deduplication, Chat-Input Synchronization,
 * and Mono 16kHz PCM -> WAV Encoding Utilities for Zarkhez Voice Input.
 *
 * Kept environment-agnostic (zero DOM globals required) so both browser capture
 * and deterministic Node.js tests exercise the exact same algorithms.
 */

const ZERO_WIDTH_RX = /[\u200B-\u200D\uFEFF]/g;
const NO_SPEECH_RX = /^\[?\s*NO[_\s-]?SPEECH\s*\]?$/i;
const EDGE_PUNCT_RX = /^[.,،۔؟?!:;"'()\[\]{}«»\-–—]+|[.,،۔؟?!:;"'()\[\]{}«»\-–—]+$/g;
const ARABIC_MARKS_RX = /[\u064B-\u065F\u0670]/g;

/**
 * Clean up raw STT model output while keeping Urdu, Sindhi, Roman Urdu,
 * numerals, and agricultural product names completely intact.
 */
export function normalizeSttSegment(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.replace(ZERO_WIDTH_RX, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || NO_SPEECH_RX.test(cleaned)) {
    return '';
  }
  return cleaned;
}

/**
 * Canonicalize a single token ONLY for overlap comparison.
 * Important: never folds Sindhi `ڪ` (U+06AA) into Urdu `ک` (U+06A9) or alters output tokens;
 * output always keeps the exact recognized script.
 */
function canonicalTokenForMatch(token: string): string {
  return token
    .replace(EDGE_PUNCT_RX, '')
    .replace(ARABIC_MARKS_RX, '')
    .replace(/\u064A/g, '\u06CC') // fold Arabic Yeh -> Farsi/Urdu Yeh for match tolerance
    .replace(/\u0643/g, '\u06A9') // fold Arabic Kaf -> Urdu Keheh (Sindhi U+06AA stays separate)
    .toLowerCase();
}

/**
 * Deduplicate boundary overlapping words between adjacent audio windows while
 * preserving repeated words spoken genuinely inside a sentence.
 */
export function mergeTranscriptWithOverlap(
  accumulatedRaw: string,
  incomingRaw: string
): string {
  const accumulated = normalizeSttSegment(accumulatedRaw);
  const incoming = normalizeSttSegment(incomingRaw);

  if (!accumulated) return incoming;
  if (!incoming) return accumulated;

  const prevTokens = accumulated.split(' ');
  const nextTokens = incoming.split(' ');
  const prevCanon = prevTokens.map(canonicalTokenForMatch);
  const nextCanon = nextTokens.map(canonicalTokenForMatch);

  // Exact full-suffix duplicate check (e.g. overlap window repeated only trailing words)
  const maxOverlap = Math.min(12, prevTokens.length, nextTokens.length);
  for (let k = maxOverlap; k >= 1; k--) {
    let matches = true;
    for (let i = 0; i < k; i++) {
      const a = prevCanon[prevCanon.length - k + i];
      const b = nextCanon[i];
      if (!a || a !== b) {
        matches = false;
        break;
      }
    }
    if (matches) {
      // Keep prev prefix + newer chunk's tokens (newer chunk has full articulation past cutoff)
      const combined = [...prevTokens.slice(0, prevTokens.length - k), ...nextTokens];
      return combined.join(' ').trim();
    }
  }

  // Handle single trailing filler/noise difference at overlap boundary (>= 2 token overlap starting 1 word back)
  if (prevTokens.length >= 3 && nextTokens.length >= 2) {
    const tailWindowStart = Math.max(0, prevCanon.length - Math.min(8, prevCanon.length));
    for (let start = tailWindowStart; start <= prevCanon.length - 2; start++) {
      const span = prevCanon.length - start;
      if (span <= nextCanon.length) {
        let matchCount = 0;
        for (let i = 0; i < span; i++) {
          if (prevCanon[start + i] && prevCanon[start + i] === nextCanon[i]) {
            matchCount++;
          }
        }
        // Only merge near-match when >= 2 consecutive anchor tokens matched or nearly whole suffix matched
        if (matchCount >= 2 && matchCount >= span - 1 && prevCanon[start] === nextCanon[0]) {
          const combined = [...prevTokens.slice(0, start), ...nextTokens];
          return combined.join(' ').trim();
        }
      }
    }
  }

  // If the entire incoming chunk (up to 4 tokens) already appeared verbatim right at the tail, skip duplicate
  if (nextTokens.length <= 4 && prevCanon.length >= nextCanon.length) {
    const searchStart = Math.max(0, prevCanon.length - 8);
    for (let i = searchStart; i <= prevCanon.length - nextCanon.length; i++) {
      let exactSlice = true;
      for (let j = 0; j < nextCanon.length; j++) {
        if (!prevCanon[i + j] || prevCanon[i + j] !== nextCanon[j]) {
          exactSlice = false;
          break;
        }
      }
      if (exactSlice) {
        return accumulated;
      }
    }
  }

  return `${accumulated} ${incoming}`.trim();
}

export interface ChunkAcceptState {
  committedText: string;
  advancedToSeq: number;
  hasGap: boolean;
}

/**
 * Guarantees out-of-order HTTP /api/stt responses are merged strictly in
 * recording sequence order (0, 1, 2, ...), never permuting or overwriting sentences.
 */
export class OrderedChunkTranscriptBuffer {
  private readonly chunks = new Map<number, string>();
  private mergedUpToSeq = -1;
  private committedText = '';
  private highestReceivedSeq = -1;

  acceptChunk(seq: number, rawTranscript: string): ChunkAcceptState {
    if (!Number.isInteger(seq) || seq < 0) {
      return this.getState();
    }

    const normalized = normalizeSttSegment(rawTranscript);
    this.chunks.set(seq, normalized);
    if (seq > this.highestReceivedSeq) {
      this.highestReceivedSeq = seq;
    }

    while (this.chunks.has(this.mergedUpToSeq + 1)) {
      const nextSeq = this.mergedUpToSeq + 1;
      const piece = this.chunks.get(nextSeq) ?? '';
      if (piece) {
        this.committedText = mergeTranscriptWithOverlap(this.committedText, piece);
      }
      this.mergedUpToSeq = nextSeq;
    }

    return this.getState();
  }

  getState(): ChunkAcceptState {
    return {
      committedText: this.committedText,
      advancedToSeq: this.mergedUpToSeq,
      hasGap: this.highestReceivedSeq > this.mergedUpToSeq,
    };
  }

  getTailContext(maxWords = 12): string {
    if (!this.committedText) return '';
    const words = this.committedText.split(/\s+/).filter(Boolean);
    return words.slice(-Math.max(1, maxWords)).join(' ');
  }

  reset(): void {
    this.chunks.clear();
    this.mergedUpToSeq = -1;
    this.committedText = '';
    this.highestReceivedSeq = -1;
  }
}

/**
 * Appends live or final dictation onto existing chat input without clobbering
 * text the user typed beforehand or recorded in previous mic taps.
 */
export function computeIncrementalInputValue(
  baseText: string,
  dictationText: string
): string {
  const cleanDictation = normalizeSttSegment(dictationText);
  if (!cleanDictation) return baseText;
  if (!baseText || baseText.trim().length === 0) return cleanDictation;

  if (/[\s\n]$/.test(baseText)) {
    return `${baseText}${cleanDictation}`;
  }
  return `${baseText} ${cleanDictation}`;
}

/**
 * Downsamples Float32 PCM samples from hardware sampleRate (e.g. 44100/48000 Hz)
 * to mono Int16 at targetSampleRate (default 16000 Hz) using boxcar averaging.
 */
export function downsampleFloat32ToInt16(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16_000
): Int16Array {
  if (!input.length) return new Int16Array(0);
  if (inputSampleRate <= targetSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const clamped = Math.max(-1, Math.min(1, input[i]));
      out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    }
    return out;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += input[i];
      count++;
    }
    const sample = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[offsetResult] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return out;
}

/**
 * Computes normalized RMS and peak amplitude (0..1) from mono Int16 PCM samples.
 */
export function computePcm16RmsAndPeak(samples: Int16Array): {
  rms: number;
  peak: number;
} {
  if (!samples.length) return { rms: 0, peak: 0 };
  let sumSq = 0;
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const norm = Math.abs(samples[i]) / 32768;
    if (norm > maxAbs) maxAbs = norm;
    sumSq += norm * norm;
  }
  return {
    rms: Math.sqrt(sumSq / samples.length),
    peak: maxAbs,
  };
}

/**
 * Encodes mono Int16 PCM samples into a standalone valid 44-byte RIFF/WAVE file.
 * Every incremental window gets its own self-contained WAV header so any server
 * STT model (Gemini / Whisper / AssemblyAI) decodes chunks independently without
 * container-header corruption.
 */
export function encodeMonoPcm16ToWavBytes(
  samples: Int16Array,
  sampleRate = 16_000
): Uint8Array<ArrayBuffer> {
  const dataByteLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM format chunk size
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate = SampleRate * 1 * 16/8
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(offset, samples[i], true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Converts bytes to Base64 safely across both Browser (`btoa`) and Node (`Buffer`).
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...Array.from(bytes.subarray(i, i + chunkSize))));
  }
  return btoa(parts.join(''));
}
