'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { api } from '../../../../lib/api';
import { OneTimeCredentials } from '../../../../lib/credentials';
import { useAskText, useConfirm, useToast } from '../../../../lib/feedback';
import { TENANT_STATUS, errorMessage, roleLabel, statusOf } from '../../../../lib/labels';
import { formatRucConDv } from '../../../../lib/ruc';
import { Badge, Button, Card, ErrorNote, Field, PageHeader, buttonGhost, dt, inputClass } from '../../../../lib/ui';

// Ficha del cliente (ADR 0005; fase 3 auditoria de paneles 2026-09-05):
// datos CRM, plan y estado, acuerdos a medida con el nombre legible de la
// funcion, presupuesto de IA y usuarios del cliente con reinicio de
// contraseña. Suspender pide confirmacion; nada de codigos internos en
// pantalla.

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

const FORM_VACIO = {
  legal_name: '',
  trade_name: '',
  ruc: '',
  status: 'trial',
  plan_code: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  notes: '',
};

export default function TenantDetailPage() {
  const askText = useAskText();
  const confirmar = useConfirm();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const tenantId = params.id;

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ email: string; pass: string } | null>(null);
  const [budget, setBudget] = useState('');
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [guardandoBudget, setGuardandoBudget] = useState(false);

  const load = useCallback(() => {
    api<TenantDetail>(`/platform/tenants/${tenantId}`)
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
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar la ficha del cliente.')));
    void api<Plan[]>('/platform/plans').then(setPlans).catch(() => undefined);
    void api<Feature[]>('/platform/features').then(setFeatures).catch(() => undefined);
  }, [tenantId]);
  useEffect(() => load(), [load]);

  const nombre = tenant ? (tenant.tradeName ?? tenant.legalName) : '';

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
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
      toast.success('Ficha guardada');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(status: 'active' | 'suspended') {
    const ok = await confirmar(
      status === 'suspended'
        ? {
            title: `Suspender a "${nombre}"`,
            message: 'Sus usuarios dejan de poder entrar al panel hasta que lo reactives. Los datos se conservan.',
            confirmLabel: 'Suspender',
          }
        : { title: `Reactivar a "${nombre}"`, message: 'Sus usuarios vuelven a poder entrar al panel.', confirmLabel: 'Reactivar', tone: 'primary' },
    );
    if (!ok) return;
    try {
      await api(`/platform/tenants/${tenantId}`, { method: 'PATCH', json: { status } });
      toast.success(status === 'suspended' ? 'Cliente suspendido' : 'Cliente reactivado');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  // Acuerdos a medida (doc 04 §3.11): forzar una funcion con motivo obligatorio
  // o quitar el acuerdo para volver a heredar del plan.
  async function forceFeature(code: string, enabled: boolean) {
    const fn = features.find((f) => f.code === code)?.name ?? code;
    const note = await askText({
      title: `${enabled ? 'Activar' : 'Apagar'} "${fn}" por acuerdo`,
      message: enabled
        ? 'La función queda activa para este cliente aunque su plan no la incluya. El motivo queda registrado en la auditoría.'
        : 'La función queda apagada para este cliente aunque su plan la incluya. El motivo queda registrado en la auditoría.',
      label: 'Motivo del acuerdo',
      placeholder: 'Ej: piloto sin cargo hasta octubre',
      confirmLabel: enabled ? 'Activar por acuerdo' : 'Apagar por acuerdo',
    });
    if (!note) return;
    try {
      await api(`/platform/tenants/${tenantId}/overrides`, { method: 'PUT', json: { feature_code: code, enabled, note } });
      toast.success(`"${fn}" ${enabled ? 'activada' : 'apagada'} por acuerdo`);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function inheritFeature(code: string) {
    const fn = features.find((f) => f.code === code)?.name ?? code;
    const ok = await confirmar({
      title: `Quitar el acuerdo sobre "${fn}"`,
      message: 'Se borra el acuerdo a medida y vuelve a regir lo que dice el plan del cliente.',
      confirmLabel: 'Volver a lo del plan',
    });
    if (!ok) return;
    try {
      await api(`/platform/tenants/${tenantId}/overrides/${code}`, { method: 'DELETE' });
      toast.success('Acuerdo quitado: rige el plan');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function guardarBudget(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoBudget(true);
    try {
      await api(`/platform/tenants/${tenantId}/bot-budget`, { method: 'PUT', json: { monthly_token_budget: Number(budget) } });
      toast.success('Presupuesto de IA guardado');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardandoBudget(false);
    }
  }

  async function resetPassword(u: TenantUser) {
    const ok = await confirmar({
      title: `Generar una contraseña nueva para ${u.fullName}`,
      message: 'La contraseña actual deja de servir y sus sesiones abiertas se cierran. La nueva se muestra una sola vez: copiala y pasásela al cliente por un canal seguro.',
      confirmLabel: 'Generar contraseña',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      const res = await api<{ email: string; temp_password: string }>(`/platform/tenants/${tenantId}/users/${u.id}/reset-password`, { method: 'POST' });
      setCreds({ email: res.email, pass: res.temp_password });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const st = tenant ? statusOf(TENANT_STATUS, tenant.status) : null;
  const uso = tenant ? tenant.bot_usage.input_tokens + tenant.bot_usage.output_tokens : 0;
  const presupuesto = tenant?.bot_budget ?? 0;
  const pct = presupuesto > 0 ? Math.min(100, Math.round((uso / presupuesto) * 100)) : 0;

  return (
    <div className="space-y-5">
      <div>
        <Link className="text-sm text-sky-700 hover:underline" href="/platform">
          ← Clientes
        </Link>
      </div>
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {tenant ? nombre : 'Ficha del cliente'}
            {st && <Badge tone={st.tone}>{st.label}</Badge>}
          </span>
        }
        description={
          tenant ? `Cliente desde ${new Date(tenant.createdAt).toLocaleDateString()} · plan ${tenant.currentPlan?.name ?? 'sin plan'} · zona horaria ${tenant.timezone}` : undefined
        }
        actions={
          tenant ? (
            <>
              <Link className={buttonGhost} href={`/platform/audit?tenant_id=${tenant.id}`}>
                Ver auditoría
              </Link>
              {tenant.status === 'suspended' ? (
                <Button variant="soft" onClick={() => void cambiarEstado('active')}>
                  Reactivar
                </Button>
              ) : (
                <Button variant="danger" onClick={() => void cambiarEstado('suspended')}>
                  Suspender
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <ErrorNote error={error} />
      {creds && <OneTimeCredentials title="Contraseña reiniciada:" email={creds.email} password={creds.pass} onHide={() => setCreds(null)} />}

      <Card title="Datos del cliente">
        <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Field label="Razón social *">
              <input className={inputClass} value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} required />
            </Field>
            <Field label="Nombre de fantasía">
              <input className={inputClass} value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} />
            </Field>
            <Field label="RUC (el dígito verificador se completa solo)">
              <input className={inputClass} placeholder="80012345" value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value })} onBlur={(e) => setForm({ ...form, ruc: formatRucConDv(e.target.value) })} />
            </Field>
            <Field label="Persona de contacto">
              <input className={inputClass} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            </Field>
            <Field label="Email de contacto">
              <input className={inputClass} type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </Field>
            <Field label="Teléfono de contacto">
              <input className={inputClass} value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
            </Field>
            <Field label="Estado">
              <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {Object.entries(TENANT_STATUS).map(([code, s]) => (
                  <option key={code} value={code}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Plan">
              <select className={inputClass} value={form.plan_code} onChange={(e) => setForm({ ...form, plan_code: e.target.value })}>
                {!form.plan_code && <option value="">sin plan</option>}
                {plans.map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2 md:col-span-3">
              <Field label="Notas internas (solo las ve el equipo de la plataforma)">
                <textarea className={`${inputClass} min-h-20`} placeholder="acuerdos, contexto comercial, recordatorios…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" loading={guardando}>
              Guardar ficha
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title="Funciones y acuerdos a medida"
        description={`Lo que el plan ${tenant?.currentPlan?.name ?? ''} no incluye se puede activar igual por acuerdo (con motivo; queda registrado). Al quitar el acuerdo vuelve a regir lo del plan.`}
      >
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Función</th>
                <th>Por plan</th>
                <th>Efectivo</th>
                <th>Acuerdo</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => {
                const planHasIt = Boolean(plans.find((p) => p.code === tenant?.currentPlan?.code)?.planFeatures.some((pf) => pf.feature.code === f.code));
                const override = tenant?.featureOverrides.find((o) => o.feature.code === f.code);
                const effective = override ? override.enabled : planHasIt;
                return (
                  <tr key={f.code} className="hover:bg-slate-50">
                    <td className="font-medium text-slate-800">{f.name}</td>
                    <td>{planHasIt ? 'incluida' : '—'}</td>
                    <td>
                      <Badge tone={effective ? 'emerald' : 'slate'}>{effective ? 'activa' : 'inactiva'}</Badge>
                    </td>
                    <td className="max-w-56 text-xs text-slate-500">{override ? `${override.enabled ? 'activada' : 'apagada'} por acuerdo: ${override.note}` : 'según el plan'}</td>
                    <td className="text-right">
                      <span className="inline-flex gap-1">
                        {effective ? (
                          <button className={buttonGhost} onClick={() => void forceFeature(f.code, false)}>
                            Apagar por acuerdo
                          </button>
                        ) : (
                          <button className={buttonGhost} onClick={() => void forceFeature(f.code, true)}>
                            Activar por acuerdo
                          </button>
                        )}
                        {override && (
                          <button className={buttonGhost} onClick={() => void inheritFeature(f.code)}>
                            Volver a lo del plan
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        tone="violet"
        title="Bot de IA: consumo y presupuesto"
        description="Al agotar el presupuesto del mes, el bot de este cliente deriva todo a una persona hasta el mes siguiente (ADR 0006)."
      >
        {tenant && (
          <div className="mb-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                Consumo de {tenant.bot_usage.period}: <b>{uso.toLocaleString('es-PY')}</b> tokens en {tenant.bot_usage.turns} respuestas
              </span>
              <span className={pct >= 100 ? 'font-medium text-red-700' : pct >= 80 ? 'text-amber-700' : 'text-slate-500'}>
                {presupuesto > 0 ? `${pct}% del presupuesto` : 'sin presupuesto definido'}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-violet-500'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => void guardarBudget(e)}>
          <Field label="Presupuesto mensual (tokens)">
            <input className={inputClass} type="number" min={0} step={1000} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          <Button variant="primary" type="submit" loading={guardandoBudget}>
            Guardar presupuesto
          </Button>
        </form>
      </Card>

      <Card
        title="Usuarios del cliente"
        description="Las cuentas con las que entran al panel de su negocio. Reiniciar una contraseña genera una temporal que se muestra una sola vez y cierra sus sesiones; queda registrado en la auditoría."
      >
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email (usuario)</th>
                <th>Rol</th>
                <th>Último acceso</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(tenant?.users ?? []).map((u) => (
                <tr key={u.id} className={u.isActive ? 'hover:bg-slate-50' : 'text-slate-400'}>
                  <td className="font-medium">{u.fullName}</td>
                  <td className="font-mono text-xs">{u.email}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <Badge tone={u.role === 'root' ? 'violet' : u.role === 'admin' ? 'sky' : 'slate'}>{roleLabel(u.role)}</Badge>
                      {!u.isActive && <Badge tone="red">desactivado</Badge>}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500">{u.lastLoginAt ? dt(u.lastLoginAt) : 'nunca entró'}</td>
                  <td className="text-right">
                    <button className={buttonGhost} onClick={() => void resetPassword(u)}>
                      Nueva contraseña
                    </button>
                  </td>
                </tr>
              ))}
              {tenant && tenant.users.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-slate-400">
                    Este cliente no tiene usuarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
