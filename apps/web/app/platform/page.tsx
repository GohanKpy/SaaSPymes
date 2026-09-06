'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { api } from '../../lib/api';
import { OneTimeCredentials } from '../../lib/credentials';
import { useConfirm, useToast } from '../../lib/feedback';
import { TENANT_STATUS, errorMessage, statusOf } from '../../lib/labels';
import { Badge, Button, EmptyRow, ErrorNote, Field, Modal, PageHeader, buttonGhost, inputClass, tableCard } from '../../lib/ui';

// Clientes de la plataforma (fase 3 auditoria de paneles 2026-09-05): lista
// con buscador y filtro, alta en ventana, estados traducidos, Suspender con
// confirmacion y credenciales con Copiar. El resto del viejo panel unico
// vive ahora en sus propias paginas (Planes, Motor del bot, etc.).

interface Plan {
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

/** Anclas de la pagina unica vieja: siguen funcionando como deep links. */
const ANCLAS: Record<string, string> = {
  '#tenants': '/platform',
  '#planes': '/platform/plans',
  '#bot': '/platform/settings/bot',
  '#seguridad': '/platform/settings/seguridad',
  '#google': '/platform/settings/google',
  '#operadores': '/platform/team',
  '#perfil': '/platform/profile',
};

const FORM_VACIO = {
  legal_name: '',
  trade_name: '',
  plan_code: '',
  root_email: '',
  root_full_name: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
};

const nombre = (t: Tenant) => t.tradeName ?? t.legalName;

export default function ClientesPage() {
  const router = useRouter();
  const confirmar = useConfirm();
  const toast = useToast();
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ email: string; pass: string } | null>(null);
  const [q, setQ] = useState('');
  const [fEstado, setFEstado] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [pendingPlans, setPendingPlans] = useState<Record<string, string>>({});

  useEffect(() => {
    const destino = ANCLAS[window.location.hash];
    if (destino && destino !== '/platform') router.replace(destino);
  }, [router]);

  const load = useCallback(() => {
    api<Tenant[]>('/platform/tenants')
      .then((t) => {
        setTenants(t);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'No se pudieron cargar los clientes.')));
    void api<Plan[]>('/platform/plans').then(setPlans).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  const visibles = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (tenants ?? []).filter(
      (t) =>
        (!fEstado || t.status === fEstado) &&
        (!term || t.legalName.toLowerCase().includes(term) || (t.tradeName ?? '').toLowerCase().includes(term)),
    );
  }, [tenants, q, fEstado]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const res = await api<{ tenant: Tenant; root_email: string; temp_password: string }>('/platform/tenants', {
        method: 'POST',
        json: {
          ...form,
          plan_code: form.plan_code || plans[0]?.code,
          trade_name: form.trade_name || undefined,
          contact_name: form.contact_name || undefined,
          contact_email: form.contact_email || undefined,
          contact_phone: form.contact_phone || undefined,
        },
      });
      setCreds({ email: res.root_email, pass: res.temp_password });
      setForm(FORM_VACIO);
      setNuevo(false);
      toast.success(`Cliente "${nombre(res.tenant)}" creado`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(t: Tenant, status: 'active' | 'suspended') {
    const ok = await confirmar(
      status === 'suspended'
        ? {
            title: `Suspender a "${nombre(t)}"`,
            message: 'Sus usuarios dejan de poder entrar al panel hasta que lo reactives. Los datos se conservan.',
            confirmLabel: 'Suspender',
          }
        : {
            title: `Reactivar a "${nombre(t)}"`,
            message: 'Sus usuarios vuelven a poder entrar al panel.',
            confirmLabel: 'Reactivar',
            tone: 'primary',
          },
    );
    if (!ok) return;
    try {
      await api(`/platform/tenants/${t.id}`, { method: 'PATCH', json: { status } });
      toast.success(status === 'suspended' ? `"${nombre(t)}" suspendido` : `"${nombre(t)}" reactivado`);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function guardarPlan(t: Tenant) {
    const plan_code = pendingPlans[t.id];
    if (!plan_code) return;
    try {
      await api(`/platform/tenants/${t.id}`, { method: 'PATCH', json: { plan_code } });
      setPendingPlans(({ [t.id]: _saved, ...rest }) => rest);
      toast.success(`Plan de "${nombre(t)}" cambiado a ${plans.find((p) => p.code === plan_code)?.name ?? plan_code}`);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clientes"
        description="Las empresas que usan el sistema. Cada una tiene su plan, su dueño con acceso al panel y su ficha con acuerdos a medida."
        actions={
          <Button variant="primary" onClick={() => setNuevo(true)}>
            Nuevo cliente
          </Button>
        }
      />
      <ErrorNote error={error} />
      {creds && (
        <OneTimeCredentials title="Cliente creado. Acceso del dueño al panel de su negocio:" email={creds.email} password={creds.pass} onHide={() => setCreds(null)} />
      )}

      <div className={tableCard}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <input className={`${inputClass} max-w-xs`} placeholder="Buscar por nombre o razón social…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={`${inputClass} max-w-[180px]`} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            {Object.entries(TENANT_STATUS).map(([code, s]) => (
              <option key={code} value={code}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="ml-auto text-xs text-slate-400">
            {visibles.length} de {tenants?.length ?? 0}
          </span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Estado</th>
              <th>Plan</th>
              <th>Cliente desde</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((t) => {
              const st = statusOf(TENANT_STATUS, t.status);
              const pendiente = pendingPlans[t.id];
              return (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td>
                    <Link className="font-medium text-sky-700 hover:underline" href={`/platform/tenants/${t.id}`}>
                      {nombre(t)}
                    </Link>
                    {t.tradeName && <span className="block text-xs text-slate-400">{t.legalName}</span>}
                  </td>
                  <td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <select
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                        aria-label="Plan"
                        value={pendiente ?? t.currentPlan?.code ?? ''}
                        onChange={(e) => setPendingPlans({ ...pendingPlans, [t.id]: e.target.value })}
                      >
                        {!t.currentPlan && <option value="">sin plan</option>}
                        {plans.map((p) => (
                          <option key={p.id} value={p.code}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {pendiente && pendiente !== (t.currentPlan?.code ?? '') && (
                        <Button variant="primary" className="px-2 py-1 text-xs" onClick={() => void guardarPlan(t)}>
                          Guardar
                        </Button>
                      )}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="text-right">
                    <span className="inline-flex gap-1">
                      <Link className={buttonGhost} href={`/platform/tenants/${t.id}`}>
                        Ver ficha
                      </Link>
                      {t.status === 'suspended' ? (
                        <button className={buttonGhost} onClick={() => void cambiarEstado(t, 'active')}>
                          Reactivar
                        </button>
                      ) : (
                        <button className={buttonGhost} onClick={() => void cambiarEstado(t, 'suspended')}>
                          Suspender
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {tenants && visibles.length === 0 && (
              <EmptyRow
                colSpan={5}
                action={
                  tenants.length === 0 ? (
                    <Button variant="soft" onClick={() => setNuevo(true)}>
                      Crear el primero
                    </Button>
                  ) : undefined
                }
              >
                {tenants.length === 0 ? 'Todavía no hay clientes.' : 'Ningún cliente coincide con la búsqueda.'}
              </EmptyRow>
            )}
            {tenants === null && !error && <EmptyRow colSpan={5}>Cargando…</EmptyRow>}
          </tbody>
        </table>
      </div>

      {nuevo && (
        <Modal
          title="Nuevo cliente"
          description="Da de alta la empresa, elegí su plan y creá la cuenta del dueño. La contraseña temporal se muestra una sola vez al terminar."
          onClose={() => setNuevo(false)}
          size="lg"
        >
          <form className="space-y-3" onSubmit={(e) => void crear(e)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Razón social *">
                <input className={inputClass} value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} required autoFocus />
              </Field>
              <Field label="Nombre de fantasía">
                <input className={inputClass} placeholder="como lo conocen sus clientes" value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} />
              </Field>
              <Field label="Plan *">
                <select className={inputClass} value={form.plan_code || plans[0]?.code || ''} onChange={(e) => setForm({ ...form, plan_code: e.target.value })} required>
                  {plans.map((p) => (
                    <option key={p.id} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Dueño (entra al panel con este email)</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre del dueño *">
                <input className={inputClass} value={form.root_full_name} onChange={(e) => setForm({ ...form, root_full_name: e.target.value })} required />
              </Field>
              <Field label="Email del dueño *">
                <input className={inputClass} type="email" value={form.root_email} onChange={(e) => setForm({ ...form, root_email: e.target.value })} required />
              </Field>
            </div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Contacto comercial (opcional)</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Persona de contacto">
                <input className={inputClass} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
              </Field>
              <Field label="Email de contacto">
                <input className={inputClass} type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              </Field>
              <Field label="Teléfono de contacto">
                <input className={inputClass} value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNuevo(false)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando} disabled={plans.length === 0}>
                Crear cliente
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
