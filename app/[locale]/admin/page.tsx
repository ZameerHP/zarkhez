'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Lock,
  Activity,
} from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { AdminSchemeVerifier } from '@/components/offline/AdminSchemeVerifier';

interface MaskedConfigItem {
  configured: boolean;
  masked: string;
}

interface ServiceHealthMetric {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  successCount: number;
  errorCount: number;
}

interface InternalDiagnosticEvent {
  requestId: string;
  timestamp: string;
  service: string;
  category: string;
  code: string;
  statusCode: number;
  severity: 'info' | 'warn' | 'error';
  summary: string;
  fieldPaths?: string[];
}

interface DiagnosticsPayload {
  authorizedAdmin?: string;
  generatedAt: string;
  envConfiguration: Record<string, MaskedConfigItem>;
  services: Record<string, ServiceHealthMetric>;
  recentEvents: InternalDiagnosticEvent[];
}

export default function AdminDiagnosticsPage() {
  const locale = useLocale() as 'en' | 'ur';
  const [adminSecretInput, setAdminSecretInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [data, setData] = useState<DiagnosticsPayload | null>(null);

  const loadDiagnostics = useCallback(async (secretOverride?: string) => {
    setLoading(true);
    setStatusNotice(null);

    try {
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

      const secret = (secretOverride ?? adminSecretInput).trim();
      if (secret) {
        headers['x-admin-secret'] = secret;
      }

      const res = await fetch('/api/admin/diagnostics', {
        method: 'GET',
        headers,
        cache: 'no-store',
      });

      if (!res.ok) {
        setAuthorized(false);
        setData(null);
        setStatusNotice(
          res.status === 401
            ? 'Administrator sign-in or valid operator secret required.'
            : 'Access restricted to verified administrators only.'
        );
        return;
      }

      const payload = (await res.json()) as DiagnosticsPayload;
      setAuthorized(true);
      setData(payload);
    } catch {
      setAuthorized(false);
      setData(null);
      setStatusNotice('Unable to reach server diagnostics endpoint right now.');
    } finally {
      setLoading(false);
    }
  }, [adminSecretInput]);

  useEffect(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

  const handleUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadDiagnostics(adminSecretInput);
  };

  return (
    <div className="min-h-screen bg-[#0c1a12] text-[#e8efe9] p-4 sm:p-6" dir="ltr">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">
                Zarkhez Internal Diagnostics Console
              </h1>
              <p className="text-xs text-emerald-200/70">
                Server-verified admin view • Credentials masked • Customer UI isolated
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {authorized && (
              <button
                type="button"
                onClick={() => void loadDiagnostics()}
                disabled={loading}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
            <Link
              href="/home"
              locale={locale}
              className="px-3.5 py-2 rounded-xl bg-emerald-600/80 hover:bg-emerald-600 text-xs font-semibold text-white flex items-center gap-1.5 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to App
            </Link>
          </div>
        </div>

        {!authorized && (
          <div className="max-w-md mx-auto rounded-2xl bg-white/5 border border-white/10 p-6 space-y-5 mt-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center">
                <Lock className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">
                  Restricted Administrator Area
                </h2>
                <p className="text-xs text-white/60">
                  Signed-in admins in ADMIN_EMAILS verify automatically.
                </p>
              </div>
            </div>

            {statusNotice && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-400/25 px-3.5 py-2.5 text-xs text-rose-200 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{statusNotice}</span>
              </div>
            )}

            <form onSubmit={handleUnlockSubmit} className="space-y-3">
              <label className="block text-xs font-medium text-white/80">
                Operator Diagnostics Secret (kept in memory only)
              </label>
              <input
                type="password"
                value={adminSecretInput}
                onChange={(e) => setAdminSecretInput(e.target.value)}
                placeholder="Enter ADMIN_DIAGNOSTICS_SECRET"
                autoComplete="off"
                className="w-full min-h-[46px] rounded-xl bg-black/40 border border-white/15 px-3.5 py-2.5 text-base sm:text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-400"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition"
              >
                {loading ? 'Verifying...' : 'Verify Admin Access'}
              </button>
            </form>
          </div>
        )}

        {authorized && data && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 flex flex-wrap items-center justify-between gap-2 text-xs text-white/75">
              <span>
                Verified operator: <strong className="text-emerald-300">{data.authorizedAdmin || 'Admin'}</strong>
              </span>
              <span>Generated at: {new Date(data.generatedAt).toLocaleString()}</span>
            </div>

            {/* Masked Server Env Configuration */}
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-white/90">
                Server Environment Readiness (Keys Strictly Masked)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(data.envConfiguration).map(([name, info]) => (
                  <div
                    key={name}
                    className="rounded-xl bg-white/5 border border-white/10 p-3.5 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-xs font-semibold text-white">{name}</p>
                      <p className="text-[11px] text-white/55 font-mono">{info.masked}</p>
                    </div>
                    {info.configured ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Service Health Matrix */}
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-white/90 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-300" />
                Runtime Service Health
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(data.services).map(([svc, metric]) => (
                  <div
                    key={svc}
                    className="rounded-xl bg-white/5 border border-white/10 p-3.5 space-y-1.5"
                  >
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                      {svc}
                    </p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/60">OK:</span>
                      <span className="font-mono text-emerald-300">{metric.successCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/60">Errors:</span>
                      <span className="font-mono text-rose-300">{metric.errorCount}</span>
                    </div>
                    {metric.lastErrorCode && (
                      <p className="text-[11px] text-amber-300/90 font-mono truncate">
                        Last: {metric.lastErrorCode}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Recent Redacted Events */}
            <section className="space-y-3">
              <h2 className="text-sm font-bold text-white/90">
                Recent Redacted Failure Events ({data.recentEvents.length})
              </h2>
              {data.recentEvents.length === 0 ? (
                <div className="rounded-2xl bg-white/5 border border-white/10 p-6 text-center text-xs text-white/55">
                  No diagnostic errors recorded in this server instance yet.
                </div>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {data.recentEvents.map((ev) => (
                    <div
                      key={`${ev.requestId}-${ev.timestamp}`}
                      className="rounded-xl bg-black/35 border border-white/10 p-3.5 space-y-1.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-white/10 font-mono text-[11px] text-emerald-300">
                            {ev.service}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 font-mono text-[11px] text-rose-200">
                            {ev.code} ({ev.statusCode})
                          </span>
                          <span className="font-mono text-[11px] text-white/50">
                            {ev.requestId}
                          </span>
                        </div>
                        <span className="text-[11px] text-white/50">
                          {new Date(ev.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-white/85 font-mono text-[11px] break-all">
                        {ev.summary}
                      </p>
                      {ev.fieldPaths && ev.fieldPaths.length > 0 && (
                        <p className="text-[11px] text-amber-300/80 font-mono">
                          Fields: {ev.fieldPaths.join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Admin Scheme Verification Queue */}
            <AdminSchemeVerifier />
          </div>
        )}
      </div>
    </div>
  );
}
