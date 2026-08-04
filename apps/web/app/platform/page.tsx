'use client';

import { useCallback, useEffect, useState } from 'react';

import { api, logout } from '../../lib/api';
import { ErrorNote, Field, buttonClass, buttonGhost, inputClass, money, useSession } from '../../lib/ui';

interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyPrice: string;
  planFeatures: { feature: { code: string; name: string } }[];
}
interface Feature {
  id: string;
  code: string;
  name: string;
}
interface Tenant {
  id: string;
  legalName: string;
  tradeName: string | null;
  status: string;
  currentPlan: { code: string; name: string } | null;
  createdAt: string;
}

export default function PlatformPage() {
  const user = useSession('platform');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ email: string; pass: string } | null>(null);
  const [form, setForm] = useState({ legal_name: '', trade_name: '', plan_code: 'standard', root_email: '', root_full_name: '' });

  const load = useCallback(() => {
    void api<Tenant[]>('/platform/tenants').then(setTenants).catch((e) => setError(String(e.message)));
    void api<Plan[]>('/platform/plans').then(setPlans).catch(() => undefined);
    void api<Feature[]>('/platform/features').then(setFeatures).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function createTenant(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ tenant: Tenant; root_email: string; temp_password: string }>('/platform/tenants', {
        method: 'POST',
        json: { ...form, trade_name: form.trade_name || undefined },
      });
      setCreds({ email: res.root_email, pass: res.temp_password });
      setForm({ legal_name: '', trade_name: '', plan_code: 'standard', root_email: '', root_full_name: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function setStatus(id: string, status: string) {
    await api(`/platform/tenants/${id}`, { method: 'PATCH', json: { status } });
    load();
  }

  async function setPlan(id: string, plan_code: string) {
    await api(`/platform/tenants/${id}`, { method: 'PATCH', json: { plan_code } });
    load();
  }

  if (!user) return null;
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Panel de plataforma</h1>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          {user.email}
          <button className={buttonGhost} onClick={() => void logout().then(() => location.assign('/login'))}>
            Salir
          </button>
        </div>
      </header>
      <ErrorNote error={error} />

      {creds && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">Tenant creado. Credenciales del root (se muestran UNA sola vez):</p>
          <p className="mt-1 font-mono">
            {creds.email} / {creds.pass}
          </p>
          <button className="mt-2 text-amber-700 underline" onClick={() => setCreds(null)}>
            Entendido, ocultar
          </button>
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-medium">Alta de tenant</h2>
        <form className="grid grid-cols-2 gap-3 md:grid-cols-3" onSubmit={(e) => void createTenant(e)}>
          <Field label="Razon social">
            <input className={inputClass} value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} required />
          </Field>
          <Field label="Nombre de fantasia">
            <input className={inputClass} value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} />
          </Field>
          <Field label="Plan">
            <select className={inputClass} value={form.plan_code} onChange={(e) => setForm({ ...form, plan_code: e.target.value })}>
              {plans.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Email del root">
            <input className={inputClass} type="email" value={form.root_email} onChange={(e) => setForm({ ...form, root_email: e.target.value })} required />
          </Field>
          <Field label="Nombre del root">
            <input className={inputClass} value={form.root_full_name} onChange={(e) => setForm({ ...form, root_full_name: e.target.value })} required />
          </Field>
          <div className="flex items-end">
            <button className={buttonClass}>Crear tenant</button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-medium">Tenants</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Empresa</th>
              <th>Estado</th>
              <th>Plan</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="py-2">{t.tradeName ?? t.legalName}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${t.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {t.status}
                  </span>
                </td>
                <td>
                  <select className="rounded border border-slate-200 px-2 py-1 text-xs" value={t.currentPlan?.code ?? ''} onChange={(e) => void setPlan(t.id, e.target.value)}>
                    {plans.map((p) => (
                      <option key={p.id} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text-right">
                  {t.status === 'suspended' ? (
                    <button className={buttonGhost} onClick={() => void setStatus(t.id, 'active')}>
                      Reactivar
                    </button>
                  ) : (
                    <button className={buttonGhost} onClick={() => void setStatus(t.id, 'suspended')}>
                      Suspender
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-medium">Planes</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className="rounded border border-slate-200 p-3 text-sm">
              <p className="font-medium">
                {p.name} <span className="text-slate-400">({p.code})</span>
              </p>
              <p className="text-slate-500">{money(p.monthlyPrice)}/mes</p>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                {p.planFeatures.map((pf) => (
                  <li key={pf.feature.code}>✓ {pf.feature.name}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Features disponibles: {features.map((f) => f.code).join(', ')}. Los precios se editan via API
          (PATCH /platform/plans/:id); pantalla completa de planes en la proxima iteracion.
        </p>
      </section>
    </main>
  );
}
