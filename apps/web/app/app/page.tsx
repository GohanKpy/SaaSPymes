'use client';

import { useEffect, useState } from 'react';

import { api } from '../../lib/api';

interface TenantInfo {
  legalName: string;
  tradeName: string | null;
  currentPlan: { name: string } | null;
}
interface EffectiveFeature {
  code: string;
  name: string;
  enabled: boolean;
  source: string;
}

export default function TenantHome() {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [features, setFeatures] = useState<EffectiveFeature[]>([]);

  useEffect(() => {
    void api<TenantInfo>('/tenant').then(setTenant).catch(() => undefined);
    void api<EffectiveFeature[]>('/tenant/features').then(setFeatures).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{tenant?.tradeName ?? tenant?.legalName ?? '…'}</h1>
      <p className="text-sm text-slate-500">Plan: {tenant?.currentPlan?.name ?? '—'}</p>
      <div className="grid gap-3 md:grid-cols-4">
        {features.map((f) => (
          <div
            key={f.code}
            className={`rounded-lg border p-3 text-sm ${f.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white opacity-60'}`}
          >
            <p className="font-medium">{f.name}</p>
            <p className="text-xs text-slate-500">
              {f.enabled ? 'Habilitada' : 'No incluida en tu plan'}
              {f.source === 'override' ? ' (acuerdo)' : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
