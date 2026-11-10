/**
 * Robust JSON Extraction & Deterministic Syntax Repair (lib/json-extractor.ts)
 * Handles markdown fences, leading/trailing commentary, trailing commas,
 * unescaped control characters inside strings, and premature root closing braces.
 */

export type JsonExtractionResult =
  | {
      ok: true;
      data: unknown;
      repaired: boolean;
      repairNotes: string[];
    }
  | {
      ok: false;
      code: 'EMPTY_RESPONSE' | 'INVALID_JSON';
      message: string;
      rawSnippet?: string;
    };

/**
 * Removes surrounding markdown fences (e.g. ```json ... ```) and trims whitespace.
 */
export function stripMarkdownCodeFences(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    s = fenceMatch[1].trim();
  } else {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return s;
}

/**
 * Escapes raw unescaped control chars inside JSON string literals and removes
 * trailing commas before closing `}` or `]` outside strings.
 */
function sanitizeJsonSyntax(input: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      // Escape unescaped literal control characters inside JSON strings
      if (ch === '\n') {
        out += '\\n';
        if (!notes.includes('escaped_literal_newlines')) notes.push('escaped_literal_newlines');
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      out += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    out += ch;
  }

  // Remove trailing commas before `}` or `]` outside strings
  const noTrailing = removeTrailingCommasOutsideStrings(out);
  if (noTrailing !== out) {
    notes.push('removed_trailing_commas');
    out = noTrailing;
  }

  // Repair premature root closing brace when valid JSON property keys immediately follow
  const repairedBraces = repairPrematureRootClosingBraces(out);
  if (repairedBraces !== out) {
    notes.push('repaired_premature_closing_brace');
    out = repairedBraces;
  }

  return { text: out, notes };
}

function removeTrailingCommasOutsideStrings(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ',') {
      // Look ahead skipping whitespace
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === '}' || input[j] === ']') {
        // Drop this trailing comma
        continue;
      }
    }

    out += ch;
  }

  return out;
}

/**
 * Fixes the exact LLM failure where a spurious closing brace `}` prematurely ends
 * the root JSON object while top-level `"key": value` properties continue right after it.
 */
function repairPrematureRootClosingBraces(input: string): string {
  const firstObj = input.indexOf('{');
  if (firstObj === -1) return input;

  let out = input.slice(0, firstObj);
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstObj; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '{') {
      braceDepth++;
      out += ch;
      continue;
    }

    if (ch === '[') {
      bracketDepth++;
      out += ch;
      continue;
    }

    if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      out += ch;
      continue;
    }

    if (ch === '}') {
      if (braceDepth === 1 && bracketDepth === 0) {
        // Look ahead to check if another JSON object property `"key":` immediately follows
        const rest = input.slice(i + 1);
        const propAhead = rest.match(/^\s*(,?\s*)"([A-Za-z0-9_]+)"\s*:/);
        if (propAhead) {
          // Drop the spurious `}` and ensure comma before the next key
          const hadComma = propAhead[1].includes(',');
          if (!hadComma) {
            out += ',';
          }
          continue;
        }
      }
      braceDepth = Math.max(0, braceDepth - 1);
      out += ch;
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Extracts the outermost balanced `{ ... }` or `[ ... ]` slice from noisy output.
 */
function sliceOutermostJson(input: string): string | null {
  const objIdx = input.indexOf('{');
  const arrIdx = input.indexOf('[');
  let start = -1;
  let openCh = '{';
  let closeCh = '}';

  if (objIdx !== -1 && (arrIdx === -1 || objIdx < arrIdx)) {
    start = objIdx;
  } else if (arrIdx !== -1) {
    start = arrIdx;
    openCh = '[';
    closeCh = ']';
  }

  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) {
        return input.slice(start, i + 1);
      }
    }
  }

  // Fallback to start..last closing bracket if truncated tail prose interfered
  const lastClose = input.lastIndexOf(closeCh);
  if (lastClose > start) {
    return input.slice(start, lastClose + 1);
  }
  return input.slice(start);
}

export function extractAndParseJson(rawText: unknown): JsonExtractionResult {
  if (rawText === null || rawText === undefined) {
    return {
      ok: false,
      code: 'EMPTY_RESPONSE',
      message: 'AI returned a null or undefined response.',
    };
  }

  if (typeof rawText !== 'string') {
    if (typeof rawText === 'object') {
      return { ok: true, data: rawText, repaired: false, repairNotes: [] };
    }
    return {
      ok: false,
      code: 'INVALID_JSON',
      message: `Expected JSON string, received ${typeof rawText}.`,
    };
  }

  const stripped = stripMarkdownCodeFences(rawText);
  if (!stripped) {
    return {
      ok: false,
      code: 'EMPTY_RESPONSE',
      message: 'AI returned an empty response.',
    };
  }

  // Attempt 1: Fast direct JSON.parse
  try {
    const parsed = JSON.parse(stripped);
    return { ok: true, data: parsed, repaired: false, repairNotes: [] };
  } catch {
    // Continue to safe extraction & syntax repair
  }

  // Attempt 2: Repair syntax issues (trailing commas, control chars, premature root brace)
  const sanitized = sanitizeJsonSyntax(stripped);
  try {
    const parsed = JSON.parse(sanitized.text);
    return {
      ok: true,
      data: parsed,
      repaired: true,
      repairNotes: sanitized.notes,
    };
  } catch {
    // Continue to outermost slice extraction + repair
  }

  // Attempt 3: Extract outermost JSON slice from surrounding commentary, then sanitize
  const sliced = sliceOutermostJson(sanitized.text) || sliceOutermostJson(stripped);
  if (sliced) {
    const reSanitized = sanitizeJsonSyntax(sliced);
    try {
      const parsed = JSON.parse(reSanitized.text);
      return {
        ok: true,
        data: parsed,
        repaired: true,
        repairNotes: ['sliced_outer_json', ...sanitized.notes, ...reSanitized.notes],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: 'INVALID_JSON',
        message: `Failed to parse Gemini JSON payload: ${msg}`,
        rawSnippet: sliced.slice(0, 260),
      };
    }
  }

  return {
    ok: false,
    code: 'INVALID_JSON',
    message: 'Response did not contain a valid JSON object or array.',
    rawSnippet: stripped.slice(0, 260),
  };
}
