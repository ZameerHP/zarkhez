'use client';

import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  adminUpsertVerifiedScheme,
  getAvailableSchemes,
  type GovernmentSchemeItem,
  type SchemeStatus,
} from '@/lib/schemes';

export function AdminSchemeVerifier() {
  const [schemes, setSchemes] = useState<GovernmentSchemeItem[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    getAvailableSchemes()
      .then(setSchemes)
      .catch(() => undefined);
  }, []);

  const handleStatusChange = async (scheme: GovernmentSchemeItem, nextStatus: SchemeStatus) => {
    setSavingId(scheme.id);
    const updated: GovernmentSchemeItem = {
      ...scheme,
      status: nextStatus,
      verifiedBy: 'Admin Portal Operator',
    };
    await adminUpsertVerifiedScheme(updated);
    const refreshed = await getAvailableSchemes();
    setSchemes(refreshed);
    setSavingId(null);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold text-white/90 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-300" />
        <span>Government Schemes Verification Queue ({schemes.length})</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {schemes.map((s) => (
          <div
            key={s.id}
            className="rounded-xl bg-black/35 border border-white/10 p-3.5 space-y-2 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-white">{s.title.en}</p>
                <p className="text-[11px] text-white/60">
                  {s.province} • Verified: {s.lastVerifiedAt}
                </p>
              </div>
              <select
                value={s.status}
                disabled={savingId === s.id}
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
          </div>
        ))}
      </div>
    </section>
  );
}
