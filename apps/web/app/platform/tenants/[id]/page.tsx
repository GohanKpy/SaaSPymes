'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { api } from '../../../../lib/api';
import { formatRucConDv } from '../../../../lib/ruc';
import { ErrorNote, Field, buttonClass, buttonGhost, inputClass, useSession } from '../../../../lib/ui';

interface TenantUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
}
interface TenantDetail {
  id: string;
  legalName: string;
  tradeName: string | null;
  ruc: string | null;
  status: string;
  timezone: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  createdAt: string;
  currentPlan: { code: string; name: string } | null;
  users: TenantUser[];
  bot_budget: number | null;
  bot_usage: { period: string; input_tokens: number; output_tokens: number; turns: number };
  featureOverrides: { enabled: boolean; note: string; feature: { code: string; name: string } }[];
}
interface Plan {
  id: string;
  code: string;
  name: string;
  planFeatures: { feature: { code: string; name: string } }[];
}
interface Feature {
  code: string;
  name: string;
}

const STATUSES = ['trial', 'active', 'suspended', 'closed'] as const;

// Ficha del cliente (ADR 0005): datos CRM del tenant, plan/estado y usuarios
// con reinicio de contraseña, todo desde el portal del dueño del sistema.
export default function TenantDetailPage() {
  const user = useSession('platform');
  const params = useParams<{ id: string }>();
  const tenantId = params.id;

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [resetCreds, setResetCreds] = useState<{ email: string; pass: string } | null>(null);
  const [budget, setBudget] = useState('');
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    legal_name: '',
    trade_name: '',
    ruc: '',
    status: 'trial',
    plan_code: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    notes: '',
  });

  const load = useCallback(() => {
    void api<TenantDetail>(`/platform/tenants/${tenantId}`)
      .then((t) => {
        setTenant(t);
        setBudget(String(t.bot_budget ?? 500000));
        setForm({
          legal_name: t.legalName,
          trade_name: t.tradeName ?? '',
          ruc: t.ruc ?? '',
          status: t.status,
          plan_code: t.currentPlan?.code ?? '',
          contact_name: t.contactName ?? '',
          contact_email: t.contactEmail ?? '',
          contact_phone: t.contactPhone ?? '',
          notes: t.notes ?? '',
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'));
    void api<Plan[]>('/platform/plans').then(setPlans).catch(() => undefined);
    void api<Feature[]>('/platform/features').then(setFeatures).catch(() => undefined);
  }, [tenantId]);
  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api(`/platform/tenants/${tenantId}`, {
        method: 'PATCH',
        json: {
          legal_name: form.legal_name,
          trade_name: form.trade_name || null,
          ruc: form.ruc || null,
          status: form.status,
          ...(form.plan_code ? { plan_code: form.plan_code } : {}),
          contact_name: form.contact_name || null,
          contact_email: form.contact_email || null,
          contact_phone: form.contact_phone || null,
          notes: form.notes || null,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  // Acuerdos a medida (doc 04 §3.11): forzar una feature con nota obligatoria
  // o quitar el acuerdo para volver a heredar del plan.
  async function forceFeature(code: string, enabled: boolean) {
    const note = prompt(`Motivo del acuerdo para ${enabled ? 'activar' : 'desactivar'} "${code}" (obligatorio):`);
    if (!note || note.trim().length < 3) return;
    setError(null);
    try {
      await api(`/platform/tenants/${tenantId}/overrides`, {
        method: 'PUT',
        json: { feature_code: code, enabled, note: note.trim() },
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function inheritFeature(code: string) {
    setError(null);
    try {
      await api(`/platform/tenants/${tenantId}/overrides/${code}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function resetPassword(u: TenantUser) {
    if (!confirm(`Generar una contrasena nueva para ${u.email}? Sus sesiones activas se cierran.`)) {
      return;
    }
    setError(null);
    try {
      const res = await api<{ email: string; temp_password: string }>(
        `/platform/tenants/${tenantId}/users/${u.id}/reset-password`,
        { method: 'POST' },
      );
      setResetCreds({ email: res.email, pass: res.temp_password });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  if (!user) return null;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <a className="text-sm text-sky-700 hover:underline" href="/platform">
            ← Panel de plataforma
          </a>
          <h1 className="text-2xl font-semibold">
            {tenant ? (tenant.tradeName ?? tenant.legalName) : 'Ficha del tenant'}
          </h1>
          {tenant && (
            <p className="text-sm text-slate-500">
              Cliente desde {new Date(tenant.createdAt).toLocaleDateString('es-PY')} · plan{' '}
              {tenant.currentPlan?.name ?? 'sin plan'} · estado {tenant.status}
            </p>
          )}
        </div>
      </header>
      <ErrorNote error={error} />

      {resetCreds && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">Contrasena reiniciada (se muestra UNA sola vez):</p>
          <p className="mt-1 font-mono">
            {resetCreds.email} / {resetCreds.pass}
          </p>
          <button className="mt-2 text-amber-700 underline" onClick={() => setResetCreds(null)}>
            Entendido, ocultar
          </button>
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-medium">Ficha del cliente (CRM)</h2>
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3" onSubmit={(e) => void save(e)}>
          <Field label="Razon social">
            <input className={inputClass} value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} required />
          </Field>
          <Field label="Nombre de fantasia">
            <input className={inputClass} value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} />
          </Field>
          <Field label="RUC (el DV se completa solo)">
            <input
              className={inputClass}
              placeholder="80012345"
              value={form.ruc}
              onChange={(e) => setForm({ ...form, ruc: e.target.value })}
              onBlur={(e) => setForm({ ...form, ruc: formatRucConDv(e.target.value) })}
            />
          </Field>
          <Field label="Contacto">
            <input className={inputClass} placeholder="nombre de tu cliente" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
          </Field>
          <Field label="Email de contacto">
            <input className={inputClass} type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
          </Field>
          <Field label="Telefono de contacto">
            <input className={inputClass} value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
          </Field>
          <Field label="Estado">
            <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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
          <div className="sm:col-span-2 md:col-span-3">
            <Field label="Notas internas (solo el dueño del sistema las ve)">
              <textarea
                className={`${inputClass} min-h-20`}
                placeholder="acuerdos, contexto comercial, recordatorios..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <button className={buttonClass}>Guardar ficha</button>
            {saved && <span className="text-sm text-emerald-600">✓ guardado</span>}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-medium">Features y acuerdos a medida</h2>
        <p className="mb-3 text-xs text-slate-500">
          Lo que el plan {tenant?.currentPlan?.name ?? ''} no incluye se puede forzar por acuerdo
          (con motivo, queda auditado). Quitar el acuerdo vuelve a heredar del plan.
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Feature</th>
              <th>Por plan</th>
              <th>Efectivo</th>
              <th>Acuerdo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {features.map((f) => {
              const planHasIt = Boolean(
                plans
                  .find((p) => p.code === tenant?.currentPlan?.code)
                  ?.planFeatures.some((pf) => pf.feature.code === f.code),
              );
              const override = tenant?.featureOverrides.find((o) => o.feature.code === f.code);
              const effective = override ? override.enabled : planHasIt;
              return (
                <tr key={f.code} className="border-t border-slate-100">
                  <td className="py-2">
                    {f.name} <span className="text-xs text-slate-400">({f.code})</span>
                  </td>
                  <td>{planHasIt ? '✓' : '—'}</td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs ${effective ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {effective ? 'activa' : 'inactiva'}
                    </span>
                  </td>
                  <td className="max-w-48 text-xs text-slate-500">
                    {override ? `forzada ${override.enabled ? 'ON' : 'OFF'} — ${override.note}` : 'hereda del plan'}
                  </td>
                  <td className="space-x-1 text-right">
                    {effective ? (
                      <button className={buttonGhost} onClick={() => void forceFeature(f.code, false)}>
                        Forzar OFF
                      </button>
                    ) : (
                      <button className={buttonGhost} onClick={() => void forceFeature(f.code, true)}>
                        Forzar ON
                      </button>
                    )}
                    {override && (
                      <button className={buttonGhost} onClick={() => void inheritFeature(f.code)}>
                        Heredar del plan
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-violet-200 bg-white p-4">
        <h2 className="mb-1 font-medium">Bot de IA: consumo y presupuesto</h2>
        <p className="mb-3 text-xs text-slate-500">
          Consumo de {tenant?.bot_usage.period ?? '—'}:{' '}
          {((tenant?.bot_usage.input_tokens ?? 0) + (tenant?.bot_usage.output_tokens ?? 0)).toLocaleString('es-PY')}{' '}
          tokens en {tenant?.bot_usage.turns ?? 0} respuestas. Al agotar el presupuesto el bot deriva
          a un humano hasta el mes siguiente (ADR 0006).
        </p>
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBudgetMsg(null);
            void api(`/platform/tenants/${tenantId}/bot-budget`, {
              method: 'PUT',
              json: { monthly_token_budget: Number(budget) },
            })
              .then(() => {
                setBudgetMsg('✓ guardado');
                load();
              })
              .catch((err) => setBudgetMsg(err instanceof Error ? err.message : 'Error'));
          }}
        >
          <Field label="Presupuesto mensual (tokens)">
            <input
              className={inputClass}
              type="number"
              min={0}
              step={1000}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </Field>
          <button className={buttonClass}>Guardar presupuesto</button>
          {budgetMsg && <span className="pb-2 text-sm text-emerald-600">{budgetMsg}</span>}
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-medium">Usuarios del tenant</h2>
        <p className="mb-3 text-xs text-slate-500">
          Reiniciar una contrasena genera una temporal que se muestra una sola vez y cierra las
          sesiones activas de ese usuario. Queda registrado en la auditoria.
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Email</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Ultimo acceso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(tenant?.users ?? []).map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="py-2 font-mono text-xs">{u.email}</td>
                <td>{u.fullName}</td>
                <td>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{u.role}</span>
                  {!u.isActive && <span className="ml-1 text-xs text-red-600">inactivo</span>}
                </td>
                <td className="text-xs text-slate-500">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('es-PY') : 'nunca'}
                </td>
                <td className="text-right">
                  <button className={buttonGhost} onClick={() => void resetPassword(u)}>
                    Reiniciar contrasena
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
