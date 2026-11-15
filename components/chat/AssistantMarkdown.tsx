'use client';

import React from 'react';

interface AssistantMarkdownProps {
  content: string;
}

const INLINE_TOKEN_REGEX = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;

/**
 * Safely renders inline Markdown (**bold**, *italic*, `code`) into React nodes
 * with zero dangerouslySetInnerHTML usage.
 */
function renderInline(text: string): React.ReactNode[] {
  if (!text) return [];
  const parts = text.split(INLINE_TOKEN_REGEX);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-extrabold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-emerald-50 border border-emerald-200/80 text-emerald-900 font-semibold text-[0.9em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={idx} className="italic text-slate-700">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(trimmed);
}

/**
 * Zero-dependency, XSS-safe Markdown block renderer tailored for bilingual
 * English, Urdu, Sindhi, and Roman Urdu agricultural explanations, schedules, and tables.
 */
export function AssistantMarkdown({ content }: AssistantMarkdownProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} className="my-2.5 border-slate-200/90" />);
      i += 1;
      continue;
    }

    // Headings (# .. ####)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const cls =
        level === 1
          ? 'text-base sm:text-lg font-extrabold text-emerald-950 mt-2 mb-1'
          : level === 2
          ? 'text-sm sm:text-base font-extrabold text-emerald-900 mt-2.5 mb-1 border-b border-emerald-100 pb-1'
          : 'text-sm font-bold text-slate-900 mt-2 mb-0.5';
      blocks.push(
        <div key={`h-${i}`} dir="auto" className={cls}>
          {renderInline(headingText)}
        </div>
      );
      i += 1;
      continue;
    }

    // Markdown Table
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(line);
      i += 2; // Skip header & separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        const rowCells = splitTableRow(lines[i]);
        if (rowCells.some((c) => c.length > 0)) {
          rows.push(rowCells);
        }
        i += 1;
      }
      blocks.push(
        <div
          key={`tbl-${i}`}
          dir="auto"
          className="my-2.5 overflow-x-auto rounded-xl border border-slate-200/90 bg-slate-50/40"
        >
          <table className="w-full text-xs sm:text-sm border-collapse text-start">
            <thead>
              <tr className="bg-emerald-900/5 border-b border-slate-200">
                {headers.map((h, hIdx) => (
                  <th
                    key={hIdx}
                    className="px-3 py-2 font-extrabold text-emerald-950 text-start whitespace-nowrap sm:whitespace-normal"
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className={
                    rIdx % 2 === 1
                      ? 'bg-white border-t border-slate-100'
                      : 'bg-slate-50/35 border-t border-slate-100'
                  }
                >
                  {headers.map((_, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-3 py-2 text-slate-800 align-top leading-snug"
                    >
                      {renderInline(row[cIdx] || '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blockquote / Tip Callout
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`bq-${i}`}
          dir="auto"
          className="my-2 px-3 py-2 rounded-xl border-s-4 border-emerald-500 bg-emerald-50/70 text-xs sm:text-sm text-emerald-950 leading-relaxed"
        >
          {quoteLines.map((ql, idx) => (
            <p key={idx}>{renderInline(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Ordered List (1. / 1۔ / 1) / ۱۔)
    if (/^[\d\u06F0-\u06F9\u0660-\u0669]+[.)۔]\s+/.test(trimmed)) {
      const items: Array<{ num: string; text: string }> = [];
      while (i < lines.length) {
        const curTrim = lines[i].trim();
        const m = curTrim.match(/^([\d\u06F0-\u06F9\u0660-\u0669]+)[.)۔]\s+(.+)$/);
        if (m) {
          items.push({ num: m[1], text: m[2] });
          i += 1;
        } else if (
          curTrim &&
          items.length > 0 &&
          /^\s{2,}[-*•]\s+/.test(lines[i])
        ) {
          items[items.length - 1].text += ` — ${curTrim.replace(/^[-*•]\s+/, '')}`;
          i += 1;
        } else {
          break;
        }
      }
      blocks.push(
        <ol key={`ol-${i}`} dir="auto" className="my-1.5 space-y-1.5 ps-1">
          {items.map((item, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 text-sm sm:text-base leading-relaxed text-slate-800"
            >
              <span className="mt-0.5 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 rounded-full bg-emerald-100 text-emerald-900 font-extrabold text-xs flex-shrink-0">
                {item.num}
              </span>
              <span className="min-w-0 flex-1">{renderInline(item.text)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Unordered List (- / * / •)
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${i}`} dir="auto" className="my-1.5 space-y-1.5 ps-1">
          {items.map((item, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 text-sm sm:text-base leading-relaxed text-slate-800"
            >
              <span
                aria-hidden="true"
                className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-600 flex-shrink-0"
              />
              <span className="min-w-0 flex-1">{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Normal paragraph block (stop at blank line or structural block marker)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (!curTrim) break;
      if (
        /^(#{1,4}\s+|[-*•]\s+|[\d\u06F0-\u06F9\u0660-\u0669]+[.)۔]\s+|>\s?|(-{3,}|\*{3,})$)/.test(curTrim) ||
        (curTrim.includes('|') &&
          i + 1 < lines.length &&
          isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      paraLines.push(curTrim);
      i += 1;
    }

    if (paraLines.length > 0) {
      blocks.push(
        <p
          key={`p-${i}`}
          dir="auto"
          className="text-sm sm:text-base leading-relaxed text-slate-800"
        >
          {paraLines.map((pl, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <br />}
              {renderInline(pl)}
            </React.Fragment>
          ))}
        </p>
      );
    }
  }

  return <div className="space-y-2 break-words">{blocks}</div>;
}
