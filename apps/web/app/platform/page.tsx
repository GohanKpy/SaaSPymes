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
interface BotEngine {
  provider: 'openai' | 'anthropic';
  model: string | null;
  keys: { openai: boolean; anthropic: boolean };
  source: 'panel' | 'env';
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

  const [engine, setEngine] = useState<BotEngine | null>(null);
  const [engineForm, setEngineForm] = useState({ provider: 'openai', model: '', openai_api_key: '', anthropic_api_key: '' });
  const [engineMsg, setEngineMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Tenant[]>('/platform/tenants').then(setTenants).catch((e) => setError(String(e.message)));
    void api<Plan[]>('/platform/plans').then(setPlans).catch(() => undefined);
    void api<Feature[]>('/platform/features').then(setFeatures).catch(() => undefined);
    void api<BotEngine>('/platform/settings/bot')
      .then((e) => {
        setEngine(e);
        setEngineForm((f) => ({ ...f, provider: e.provider, model: e.model ?? '' }));
      })
      .catch(() => undefined);
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

  const [pendingPlans, setPendingPlans] = useState<Record<string, string>>({});
  const [savedTenant, setSavedTenant] = useState<string | null>(null);

  async function setStatus(id: string, status: string) {
    try {
      await api(`/platform/tenants/${id}`, { method: 'PATCH', json: { status } });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function savePlan(id: string) {
    const plan_code = pendingPlans[id];
    if (!plan_code) return;
    try {
      await api(`/platform/tenants/${id}`, { method: 'PATCH', json: { plan_code } });
      setPendingPlans(({ [id]: _saved, ...rest }) => rest);
      setSavedTenant(id);
      setTimeout(() => setSavedTenant(null), 2500);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  if (!user) return null;
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Panel de plataforma</h1>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          {user.email}
          <button className={buttonGhost} onClick={() => void logout().then(() => location.assign('/platform/login'))}>
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

      <section className="rounded-lg border border-violet-200 bg-white p-4">
        <h2 className="mb-1 font-medium">Motor del bot (IA)</h2>
        <p className="mb-3 text-xs text-slate-500">
          Proveedor, modelo y llaves se gestionan aca (ADR 0003): rotar una llave o cambiar de
          proveedor rige en menos de 30 segundos, sin deploy. Las llaves se guardan cifradas y
          jamas se vuelven a mostrar.
          {engine && (
            <>
              {' '}Estado: <b>{engine.provider}</b>
              {engine.model ? ` · modelo ${engine.model}` : ' · modelo por defecto'} · llaves:
              OpenAI {engine.keys.openai ? '✓' : '✗'}, Anthropic {engine.keys.anthropic ? '✓' : '✗'}
              {engine.source === 'env' ? ' · (config de entorno: guarda para pasarla al panel)' : ''}
            </>
          )}
        </p>
        <form
          className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            setEngineMsg(null);
            void api<BotEngine>('/platform/settings/bot', {
              method: 'PUT',
              json: {
                provider: engineForm.provider,
                model: engineForm.model || null,
                ...(engineForm.openai_api_key ? { openai_api_key: engineForm.openai_api_key } : {}),
                ...(engineForm.anthropic_api_key ? { anthropic_api_key: engineForm.anthropic_api_key } : {}),
              },
            })
              .then((updated) => {
                setEngine(updated);
                setEngineForm((f) => ({ ...f, openai_api_key: '', anthropic_api_key: '' }));
                setEngineMsg('Motor actualizado; rige en menos de 30 s.');
              })
              .catch((err) => setEngineMsg(err instanceof Error ? err.message : 'Error'));
          }}
        >
          <Field label="Proveedor">
            <select className={inputClass} value={engineForm.provider} onChange={(e) => setEngineForm({ ...engineForm, provider: e.target.value })}>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>
          <Field label="Modelo">
            <input className={inputClass} placeholder="por defecto del proveedor" value={engineForm.model} onChange={(e) => setEngineForm({ ...engineForm, model: e.target.value })} />
          </Field>
          <Field label="Llave OpenAI">
            <input
              className={inputClass}
              type="password"
              autoComplete="off"
              placeholder={engine?.keys.openai ? 'cargada ✓ — vacio = mantener' : 'sk-...'}
              value={engineForm.openai_api_key}
              onChange={(e) => setEngineForm({ ...engineForm, openai_api_key: e.target.value })}
            />
          </Field>
          <Field label="Llave Anthropic">
            <input
              className={inputClass}
              type="password"
              autoComplete="off"
              placeholder={engine?.keys.anthropic ? 'cargada ✓ — vacio = mantener' : 'sk-ant-...'}
              value={engineForm.anthropic_api_key}
              onChange={(e) => setEngineForm({ ...engineForm, anthropic_api_key: e.target.value })}
            />
          </Field>
          <button className={`${buttonClass} h-fit`}>Guardar motor</button>
        </form>
        {engineMsg && <p className="mt-2 text-xs text-slate-600">{engineMsg}</p>}
      </section>

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
                  <div className="flex items-center gap-1.5">
                    <select
                      className="rounded border border-slate-200 px-2 py-1 text-xs"
                      value={pendingPlans[t.id] ?? t.currentPlan?.code ?? ''}
                      onChange={(e) => setPendingPlans({ ...pendingPlans, [t.id]: e.target.value })}
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {pendingPlans[t.id] && pendingPlans[t.id] !== (t.currentPlan?.code ?? '') && (
                      <button
                        className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700"
                        onClick={() => void savePlan(t.id)}
                      >
                        Guardar
                      </button>
                    )}
                    {savedTenant === t.id && <span className="text-xs text-emerald-600">✓ guardado</span>}
                  </div>
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
