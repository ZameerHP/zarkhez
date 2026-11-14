'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Calendar, X } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  adminSaveSchemeUpdate,
  adminTriggerSchemesRefresh,
  fetchSchemesCatalog,
  type GovernmentSchemeItem,
  type SchemesStorageSource,
  type SchemeStatus,
} from '@/lib/schemes';

interface AdminSchemeVerifierProps {
  adminSecret?: string;
}

export function AdminSchemeVerifier({ adminSecret = '' }: AdminSchemeVerifierProps) {
  const [schemes, setSchemes] = useState<GovernmentSchemeItem[]>([]);
  const [source, setSource] = useState<SchemesStorageSource>('bundled');
  const [lastAutoCheckAt, setLastAutoCheckAt] = useState<string | null>(null);
  const [draftDates, setDraftDates] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const buildAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {};
    const supabase = getSupabaseClient();
    if (supabase) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
    }
    const trimmedSecret = adminSecret.trim();
    if (trimmedSecret) {
      headers['x-admin-secret'] = trimmedSecret;
    }
    return headers;
  }, [adminSecret]);

  const loadCatalog = useCallback(async () => {
    try {
      const catalog = await fetchSchemesCatalog();
      setSchemes(catalog.schemes);
      setSource(catalog.source);
      setLastAutoCheckAt(catalog.lastAutoCheckAt);
      const nextDrafts: Record<string, string> = {};
      for (const s of catalog.schemes) {
        nextDrafts[s.id] = s.expiresAt ?? '';
      }
      setDraftDates(nextDrafts);
    } catch {
      // Leave existing UI state untouched on network blip
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const handleStatusChange = async (
    scheme: GovernmentSchemeItem,
    nextStatus: SchemeStatus
  ) => {
    setSavingId(scheme.id);
    setFeedback(null);
    const headers = await buildAuthHeaders();
    const res = await adminSaveSchemeUpdate(
      {
        id: scheme.id,
        status: nextStatus,
        expiresAt: draftDates[scheme.id]?.trim() || null,
        verifiedBy: 'Admin Portal Operator',
      },
      headers
    );
    if (res.ok) {
      await loadCatalog();
      setFeedback({
        ok: true,
        text: `Updated "${scheme.title.en}" (${res.source || source} persisted).`,
      });
    } else {
      setFeedback({ ok: false, text: res.error || 'Failed to update scheme.' });
    }
    setSavingId(null);
  };

  const handleSaveDeadline = async (
    scheme: GovernmentSchemeItem,
    nextDate: string | null
  ) => {
    setSavingId(scheme.id);
    setFeedback(null);
    const headers = await buildAuthHeaders();
    const res = await adminSaveSchemeUpdate(
      {
        id: scheme.id,
        status: scheme.status,
        expiresAt: nextDate,
        verifiedBy: 'Admin Portal Operator',
      },
      headers
    );
    if (res.ok) {
      await loadCatalog();
      setFeedback({
        ok: true,
        text: nextDate
          ? `Saved deadline ${nextDate} for "${scheme.title.en}".`
          : `Cleared deadline for "${scheme.title.en}".`,
      });
    } else {
      setFeedback({ ok: false, text: res.error || 'Failed to save deadline.' });
    }
    setSavingId(null);
  };

  const handleRefreshNow = async () => {
    setRefreshing(true);
    setFeedback(null);
    const headers = await buildAuthHeaders();
    const res = await adminTriggerSchemesRefresh(headers);
    if (res.ok) {
      await loadCatalog();
      setFeedback({
        ok: true,
        text: `Auto-check complete: ${res.checkedCount ?? schemes.length} checked, ${
          res.expiredCount ?? 0
        } expired (${res.source || source}).`,
      });
    } else {
      setFeedback({ ok: false, text: res.error || 'Auto-check failed.' });
    }
    setRefreshing(false);
  };

  const expiredCount = schemes.filter((s) => s.status === 'expired').length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-white/90 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-300" />
            <span>
              Government Schemes Auto-Update & Expiry Queue ({schemes.length})
            </span>
          </h2>
          <p className="text-[11px] text-white/55 mt-0.5">
            Store: <span className="font-mono text-white/80">{source}</span> • Expired:{' '}
            <span className="font-mono text-amber-300">{expiredCount}</span> • Last auto-check:{' '}
            <span className="font-mono text-white/80">
              {lastAutoCheckAt ? new Date(lastAutoCheckAt).toLocaleString() : 'Never yet'}
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleRefreshNow()}
          disabled={refreshing}
          className="px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/45 border border-emerald-400/35 text-xs font-bold text-emerald-100 flex items-center gap-1.5 disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Auto-Check Official Portals Now</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-lg px-3 py-2 text-xs border ${
            feedback.ok
              ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-200'
              : 'bg-red-950/50 border-red-500/30 text-red-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {schemes.map((s) => {
          const draftDate = draftDates[s.id] ?? '';
          const isSaving = savingId === s.id;

          return (
            <div
              key={s.id}
              className="rounded-xl bg-black/35 border border-white/10 p-3.5 space-y-2.5 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="font-bold text-white">{s.title.en}</p>
                  <p className="text-[11px] text-white/60">
                    {s.province} • Verified: {s.lastVerifiedAt}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {s.expiredAutoDetected && (
                      <span className="px-1.5 py-0.5 rounded bg-red-500/20 border border-red-400/30 text-[10px] font-bold text-red-200">
                        Auto-Expired
                      </span>
                    )}
                    {typeof s.portalReachable === 'boolean' && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                          s.portalReachable
                            ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200'
                            : 'bg-amber-500/15 border-amber-400/30 text-amber-200'
                        }`}
                      >
                        {s.portalReachable ? 'Portal Reachable' : 'Portal Timeout/Restricted'}
                      </span>
                    )}
                  </div>
                </div>

                <select
                  value={s.status}
                  disabled={isSaving}
                  onChange={(e) =>
                    void handleStatusChange(s, e.target.value as SchemeStatus)
                  }
                  aria-label={`Verification status for ${s.title.en}`}
                  className="bg-[#062409] text-white border border-white/25 rounded-lg px-2 py-1 text-[11px] font-bold"
                >
                  <option value="ongoing">ongoing</option>
                  <option value="verify_on_portal">verify_on_portal</option>
                  <option value="expired">expired</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-white/10">
                <Calendar className="w-3.5 h-3.5 text-white/55" />
                <label className="text-[11px] text-white/65" htmlFor={`deadline-${s.id}`}>
                  Deadline:
                </label>
                <input
                  id={`deadline-${s.id}`}
                  type="date"
                  value={draftDate}
                  disabled={isSaving}
                  onChange={(e) =>
                    setDraftDates((prev) => ({ ...prev, [s.id]: e.target.value }))
                  }
                  className="bg-[#062409] text-white border border-white/20 rounded-md px-2 py-0.5 text-[11px]"
                />
                <button
                  type="button"
                  disabled={isSaving || draftDate === (s.expiresAt ?? '')}
                  onClick={() => void handleSaveDeadline(s, draftDate || null)}
                  className="px-2 py-0.5 rounded-md bg-white/15 hover:bg-white/25 disabled:opacity-40 text-[11px] font-semibold text-white"
                >
                  Save
                </button>
                {s.expiresAt && (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => {
                      setDraftDates((prev) => ({ ...prev, [s.id]: '' }));
                      void handleSaveDeadline(s, null);
                    }}
                    title="Clear deadline"
                    aria-label={`Clear deadline for ${s.title.en}`}
                    className="p-1 rounded-md bg-white/10 hover:bg-red-500/25 text-white/70 hover:text-red-200"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
