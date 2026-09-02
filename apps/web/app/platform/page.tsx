'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api, logout } from '../../lib/api';
import { AssistantWidget } from './assistant';
import { OperatorsSection, ProfileSection } from './operators';
import {
  Badge,
  Card,
  EmptyRow,
  ErrorNote,
  Field,
  buttonClass,
  buttonGhost,
  inputClass,
  money,
  tableCard,
  useSession,
} from '../../lib/ui';

interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyPrice: string;
  maxUsers: number;
  maxBranches: number;
  isActive: boolean;
  planFeatures: { feature: { code: string; name: string } }[];
}
interface PlanForm {
  code: string;
  name: string;
  monthly_price: string;
  max_users: number;
  max_branches: number;
  feature_codes: string[];
}
interface Feature {
  id: string;
  code: string;
  name: string;
}
interface GoogleCfg {
  client_id: string | null;
  has_secret: boolean;
}
interface BotEngine {
  provider: 'openai' | 'anthropic';
  model: string | null;
  base_prompt: string | null;
  reply_debounce_seconds: number;
  hourly_budget_divisor: number;
  fallback_notice: string | null;
  budget_notice: string | null;
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

const STATUS_TONE: Record<string, 'emerald' | 'amber' | 'red' | 'slate'> = {
  active: 'emerald',
  trial: 'amber',
  suspended: 'red',
  closed: 'slate',
};

// Menu lateral del portal admin: ancla a las secciones de esta misma pagina.
const MENU: { title: string; items: { href: string; label: string }[] }[] = [
  {
    title: 'Clientes',
    items: [
      { href: '#tenants', label: 'Clientes' },
      { href: '#planes', label: 'Planes' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { href: '#bot', label: 'Motor del bot (IA)' },
      { href: '#seguridad', label: 'Seguridad' },
      { href: '#google', label: 'Google Calendar' },
    ],
  },
  {
    title: 'Portal',
    items: [
      { href: '#operadores', label: 'Usuarios del portal' },
      { href: '#perfil', label: 'Mi perfil' },
    ],
  },
];

export default function PlatformPage() {
  const user = useSession('platform');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ email: string; pass: string } | null>(null);
  const emptyForm = {
    legal_name: '',
    trade_name: '',
    plan_code: 'standard',
    root_email: '',
    root_full_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
  };
  const [form, setForm] = useState(emptyForm);

  const [engine, setEngine] = useState<BotEngine | null>(null);
  const [engineForm, setEngineForm] = useState({ provider: 'openai', model: '', openai_api_key: '', anthropic_api_key: '' });
  const [engineMsg, setEngineMsg] = useState<string | null>(null);
  const [basePrompt, setBasePrompt] = useState('');
  // Parametros operativos del bot (nada hardcodeado: el panel manda).
  const [engineOps, setEngineOps] = useState({ debounce: 15, divisor: 30, fallback: '', budget: '' });

  // App OAuth de Google del sistema (ADR 0007).
  const [googleCfg, setGoogleCfg] = useState<GoogleCfg | null>(null);
  const [googleForm, setGoogleForm] = useState({ client_id: '', client_secret: '' });
  const [googleMsg, setGoogleMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Modulo de seguridad: valores del bloqueo de login (viven en el panel).
  const [security, setSecurity] = useState({ login_max_attempts: 10, login_window_min: 10, login_block_min: 10 });
  const [securityMsg, setSecurityMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Tenant[]>('/platform/tenants').then(setTenants).catch((e) => setError(String(e.message)));
    void api<Plan[]>('/platform/plans').then(setPlans).catch(() => undefined);
    void api<Feature[]>('/platform/features').then(setFeatures).catch(() => undefined);
    void api<BotEngine>('/platform/settings/bot')
      .then((e) => {
        setEngine(e);
        setEngineForm((f) => ({ ...f, provider: e.provider, model: e.model ?? '' }));
        setBasePrompt(e.base_prompt ?? '');
        setEngineOps({
          debounce: e.reply_debounce_seconds,
          divisor: e.hourly_budget_divisor,
          fallback: e.fallback_notice ?? '',
          budget: e.budget_notice ?? '',
        });
      })
      .catch(() => undefined);
    void api<GoogleCfg>('/platform/settings/google')
      .then((g) => {
        setGoogleCfg(g);
        setGoogleForm((f) => ({ ...f, client_id: g.client_id ?? '' }));
      })
      .catch(() => undefined);
    void api<{ login_max_attempts: number; login_window_min: number; login_block_min: number }>(
      '/platform/settings/security',
    )
      .then((s) =>
        setSecurity({
          login_max_attempts: s.login_max_attempts,
          login_window_min: s.login_window_min,
          login_block_min: s.login_block_min,
        }),
      )
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
        json: {
          ...form,
          trade_name: form.trade_name || undefined,
          contact_name: form.contact_name || undefined,
          contact_email: form.contact_email || undefined,
          contact_phone: form.contact_phone || undefined,
        },
      });
      setCreds({ email: res.root_email, pass: res.temp_password });
      setForm(emptyForm);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const [pendingPlans, setPendingPlans] = useState<Record<string, string>>({});
  const [savedTenant, setSavedTenant] = useState<string | null>(null);

  // Gestion de planes (doc 04 §3.11): crear y editar con features tildadas.
  const emptyPlan: PlanForm = { code: '', name: '', monthly_price: '0', max_users: 3, max_branches: 1, feature_codes: [] };
  const [planForm, setPlanForm] = useState<PlanForm | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  // ok distingue exito de error: el mensaje se pinta verde o rojo segun eso.
  const [planMsg, setPlanMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function startEditPlan(p: Plan) {
    setEditingPlanId(p.id);
    setPlanForm({
      code: p.code,
      name: p.name,
      monthly_price: p.monthlyPrice,
      max_users: p.maxUsers,
      max_branches: p.maxBranches,
      feature_codes: p.planFeatures.map((pf) => pf.feature.code),
    });
  }

  async function savePlanForm(e: React.FormEvent) {
    e.preventDefault();
    if (!planForm) return;
    setPlanMsg(null);
    const body = { ...planForm, monthly_price: planForm.monthly_price || '0' };
    try {
      if (editingPlanId) {
        const { code: _code, ...rest } = body;
        await api(`/platform/plans/${editingPlanId}`, { method: 'PATCH', json: rest });
      } else {
        await api('/platform/plans', { method: 'POST', json: body });
      }
      setPlanForm(null);
      setEditingPlanId(null);
      setPlanMsg({ text: '✓ guardado', ok: true });
      setTimeout(() => setPlanMsg(null), 2500);
      load();
    } catch (e) {
      // Con errores de campo del API (422) se muestra QUE campo fallo, no
      // solo el titulo generico "Datos invalidos".
      const fields =
        e instanceof ApiError && e.problem.errors
          ? ': ' +
            Object.entries(e.problem.errors)
              .map(([campo, msgs]) => `${campo} (${msgs.join(', ')})`)
              .join(' · ')
          : '';
      setPlanMsg({ text: (e instanceof Error ? e.message : 'Error') + fields, ok: false });
    }
  }

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

  const salir = () => void logout().then(() => location.assign('/platform/login'));

  if (!user) return null;
  return (
    <div className="min-h-screen lg:pl-60">
      <AssistantWidget />
      {/* Menu lateral del portal admin (oscuro: identidad distinta al portal de clientes) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-slate-900 text-slate-300 lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-800 px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500 text-sm font-bold text-white">
            P
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">PyMEs SaaS</p>
            <p className="text-[11px] text-slate-400">Panel de plataforma</p>
          </div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {MENU.map((g) => ({
            ...g,
            items: g.items.filter((item) => item.href !== '#operadores' || user.role === 'admin'),
          })).map((g) => (
            <div key={g.title}>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.title}</p>
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="block rounded-md px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <p className="truncate px-1 text-xs text-slate-400">{user.email}</p>
          <div className="mt-2 flex gap-2">
            <a
              className="flex-1 rounded-md border border-slate-700 px-3 py-1.5 text-center text-sm text-slate-300 transition-colors hover:bg-slate-800"
              href="/guia.html"
              target="_blank"
              rel="noopener"
            >
              Guía
            </a>
            <button
              className="flex-1 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-800"
              onClick={salir}
            >
              Salir
            </button>
          </div>
        </div>
      </aside>

      <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        {/* pr-14: aire para la burbuja fija del asistente arriba a la derecha */}
        <header className="flex items-center justify-between pr-14">
          <h1 className="text-2xl font-semibold text-slate-900">Panel de plataforma</h1>
          <div className="flex items-center gap-3 text-sm text-slate-500 lg:hidden">
            {user.email}
            <a className={buttonGhost} href="/guia.html" target="_blank" rel="noopener">
              Guia
            </a>
            <button className={buttonGhost} onClick={salir}>
              Salir
            </button>
          </div>
        </header>
        <ErrorNote error={error} />

        {creds && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
            <p className="font-medium">Cliente creado. Usuario y contraseña de acceso (se muestran UNA sola vez: guardalos y pasaselos):</p>
            <p className="mt-1 font-mono">
              {creds.email} / {creds.pass}
            </p>
            <button className="mt-2 text-amber-700 underline" onClick={() => setCreds(null)}>
              Entendido, ocultar
            </button>
          </div>
        )}

        <div id="tenants" className="scroll-mt-6 space-y-6">
          <Card title="Nuevo cliente" description="Da de alta la empresa de tu cliente, elegi su plan y crea su cuenta de acceso principal.">
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
              <Field label="Email del dueño (con este entra al panel)">
                <input className={inputClass} type="email" value={form.root_email} onChange={(e) => setForm({ ...form, root_email: e.target.value })} required />
              </Field>
              <Field label="Nombre del dueño">
                <input className={inputClass} value={form.root_full_name} onChange={(e) => setForm({ ...form, root_full_name: e.target.value })} required />
              </Field>
              <Field label="Persona de contacto">
                <input className={inputClass} placeholder="nombre de tu cliente" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
              </Field>
              <Field label="Email de contacto">
                <input className={inputClass} type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
              </Field>
              <Field label="Telefono de contacto">
                <input className={inputClass} value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <button className={buttonClass}>Crear cliente</button>
              </div>
            </form>
          </Card>

          <div className={tableCard}>
            <div className="border-b border-slate-100 p-3">
              <h2 className="font-medium text-slate-900">Clientes</h2>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Estado</th>
                  <th>Plan</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td>
                      <a className="font-medium text-sky-700 hover:underline" href={`/platform/tenants/${t.id}`}>
                        {t.tradeName ?? t.legalName}
                      </a>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[t.status] ?? 'slate'}>{t.status}</Badge>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <select
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
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
                            className="rounded-md bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700"
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
                {tenants.length === 0 && <EmptyRow colSpan={4}>Sin tenants todavía: creá el primero arriba.</EmptyRow>}
              </tbody>
            </table>
          </div>
        </div>

        <div id="planes" className="scroll-mt-6">
          <Card
            title="Planes"
            actions={
              <div className="flex items-center gap-2">
                {planMsg && (
                  <span className={`text-sm ${planMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{planMsg.text}</span>
                )}
                <button
                  className={buttonGhost}
                  onClick={() => {
                    setEditingPlanId(null);
                    setPlanForm(planForm && !editingPlanId ? null : { ...emptyPlan });
                  }}
                >
                  {planForm && !editingPlanId ? 'Cancelar' : '+ Nuevo plan'}
                </button>
              </div>
            }
          >
            {planForm && (
              <form
                className="mb-4 grid grid-cols-2 items-end gap-3 rounded-md border border-sky-200 bg-sky-50/50 p-3 md:grid-cols-4"
                onSubmit={(e) => void savePlanForm(e)}
              >
                <Field label="Codigo">
                  <input
                    className={inputClass}
                    value={planForm.code}
                    onChange={(e) => setPlanForm({ ...planForm, code: e.target.value })}
                    disabled={Boolean(editingPlanId)}
                    pattern="[a-z0-9_-]+"
                    required
                  />
                </Field>
                <Field label="Nombre">
                  <input className={inputClass} value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} required />
                </Field>
                <Field label="Precio mensual (Gs)">
                  <input className={inputClass} type="number" min={0} step={1000} value={planForm.monthly_price} onChange={(e) => setPlanForm({ ...planForm, monthly_price: e.target.value })} />
                </Field>
                <div className="flex gap-2">
                  <Field label="Max. usuarios">
                    <input className={inputClass} type="number" min={1} value={planForm.max_users} onChange={(e) => setPlanForm({ ...planForm, max_users: Number(e.target.value) })} />
                  </Field>
                  <Field label="Max. sucursales">
                    <input className={inputClass} type="number" min={1} value={planForm.max_branches} onChange={(e) => setPlanForm({ ...planForm, max_branches: Number(e.target.value) })} />
                  </Field>
                </div>
                <div className="col-span-2 md:col-span-3">
                  <Field label="Funciones incluidas">
                    <div className="flex flex-wrap gap-3">
                      {features.map((f) => (
                        <label key={f.code} className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={planForm.feature_codes.includes(f.code)}
                            onChange={(e) =>
                              setPlanForm({
                                ...planForm,
                                feature_codes: e.target.checked
                                  ? [...planForm.feature_codes, f.code]
                                  : planForm.feature_codes.filter((c) => c !== f.code),
                              })
                            }
                          />
                          {f.name}
                        </label>
                      ))}
                    </div>
                  </Field>
                </div>
                <div>
                  <button className={buttonClass}>{editingPlanId ? 'Guardar cambios' : 'Crear plan'}</button>
                </div>
              </form>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              {plans.map((p) => (
                <div
                  key={p.id}
                  className={`rounded-md border p-3 text-sm ${editingPlanId === p.id ? 'border-sky-400' : 'border-slate-200'}`}
                >
                  <div className="flex items-start justify-between">
                    <p className="font-medium">
                      {p.name} <span className="text-slate-400">({p.code})</span>
                    </p>
                    <button className="text-xs text-sky-700 hover:underline" onClick={() => startEditPlan(p)}>
                      Editar
                    </button>
                  </div>
                  <p className="text-slate-500">
                    {money(p.monthlyPrice)}/mes · {p.maxUsers} usuarios · {p.maxBranches} suc.
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    {p.planFeatures.map((pf) => (
                      <li key={pf.feature.code}>✓ {pf.feature.name}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Los acuerdos a medida (darle a un cliente una función suelta, con o sin cargo extra) se
              gestionan en la ficha de cada cliente.
            </p>
          </Card>
        </div>

        <div id="bot" className="scroll-mt-6">
          <Card
            tone="violet"
            title="Motor del bot (IA)"
            description={
              <>
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
              </>
            }
          >
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
                    base_prompt: basePrompt.trim() || null,
                    reply_debounce_seconds: engineOps.debounce,
                    hourly_budget_divisor: engineOps.divisor,
                    fallback_notice: engineOps.fallback.trim() || null,
                    budget_notice: engineOps.budget.trim() || null,
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
              <Field label="Espera antes de responder (segundos)">
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  max={120}
                  value={engineOps.debounce}
                  onChange={(e) => setEngineOps({ ...engineOps, debounce: Number(e.target.value) })}
                />
              </Field>
              <Field label="Tope horario de IA (presupuesto mensual ÷ este valor)">
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={720}
                  value={engineOps.divisor}
                  onChange={(e) => setEngineOps({ ...engineOps, divisor: Number(e.target.value) })}
                />
              </Field>
              <div className="col-span-1 grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-3">
                <Field label="Aviso si la IA falla (vacio = texto por defecto)">
                  <textarea
                    className={`${inputClass} h-16 text-xs`}
                    placeholder="Gracias por tu mensaje! En breve una persona del equipo te responde por este mismo chat."
                    value={engineOps.fallback}
                    onChange={(e) => setEngineOps({ ...engineOps, fallback: e.target.value })}
                  />
                </Field>
                <Field label="Aviso al agotarse el presupuesto (vacio = default)">
                  <textarea
                    className={`${inputClass} h-16 text-xs`}
                    placeholder="Gracias por escribirnos. En este momento una persona del negocio va a continuar la conversacion por este mismo chat."
                    value={engineOps.budget}
                    onChange={(e) => setEngineOps({ ...engineOps, budget: e.target.value })}
                  />
                </Field>
              </div>
              <div className="col-span-1 sm:col-span-2 lg:col-span-5">
                <Field label="Guia de atencion estandar (rige para el bot de TODOS los clientes; vacio = la del sistema)">
                  <textarea
                    className={`${inputClass} h-40 font-mono text-xs`}
                    placeholder="Vacio: rige la guia por defecto del sistema (personalidad, identificacion del cliente, estilo WhatsApp, datos del negocio). Variables: {{nombre_negocio}}, {{razon_social}}, {{rubro}}, {{direccion}}, {{telefono}}, {{email}}. Las reglas de seguridad no viven aca y no son editables."
                    value={basePrompt}
                    onChange={(e) => setBasePrompt(e.target.value)}
                  />
                </Field>
                <p className="mt-1 text-xs text-slate-400">
                  Cada cliente puede complementarla con sus instrucciones; con su consentimiento explicito
                  pueden priorizarse sobre esta guia, nunca sobre las reglas de seguridad (ADR 0008).
                </p>
              </div>
            </form>
            {engineMsg && <p className="mt-2 text-xs text-slate-600">{engineMsg}</p>}
          </Card>
        </div>

        <div id="seguridad" className="scroll-mt-6">
          <Card
            tone="amber"
            title="Seguridad"
            description="Bloqueo de login por intentos fallidos (aplica por cuenta y por IP, en ambos portales). Rige en menos de 30 segundos, sin deploy."
          >
            <form
              className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                setSecurityMsg(null);
                void api('/platform/settings/security', { method: 'PUT', json: security })
                  .then(() => setSecurityMsg('✓ guardado; rige en menos de 30 s'))
                  .catch((err) => setSecurityMsg(err instanceof Error ? err.message : 'Error'));
              }}
            >
              <Field label="Intentos fallidos max.">
                <input className={inputClass} type="number" min={1} max={1000} value={security.login_max_attempts} onChange={(e) => setSecurity({ ...security, login_max_attempts: Number(e.target.value) })} />
              </Field>
              <Field label="Ventana de conteo (min)">
                <input className={inputClass} type="number" min={1} max={1440} value={security.login_window_min} onChange={(e) => setSecurity({ ...security, login_window_min: Number(e.target.value) })} />
              </Field>
              <Field label="Duracion del bloqueo (min)">
                <input className={inputClass} type="number" min={1} max={1440} value={security.login_block_min} onChange={(e) => setSecurity({ ...security, login_block_min: Number(e.target.value) })} />
              </Field>
              <button className={`${buttonClass} h-fit`}>Guardar seguridad</button>
            </form>
            {securityMsg && <p className="mt-2 text-xs text-slate-600">{securityMsg}</p>}
          </Card>
        </div>

        <div id="google" className="scroll-mt-6">
          <Card
            title="Google Calendar (app OAuth del sistema)"
            description={
              <>
                Credencial de TU app en Google Cloud (identifica al software, como la app de Meta): una
                sola para toda la plataforma. Cada cliente conecta despues SU cuenta y SU calendario desde
                sus Ajustes. El secret se guarda cifrado y no se vuelve a mostrar.
                {googleCfg && (
                  <>
                    {' '}Estado: client_id {googleCfg.client_id ? '✓' : '✗'} · secret{' '}
                    {googleCfg.has_secret ? 'cargado ✓' : '✗'}
                  </>
                )}
              </>
            }
          >
            <form
              className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                setGoogleMsg(null);
                void api<GoogleCfg>('/platform/settings/google', {
                  method: 'PUT',
                  json: {
                    client_id: googleForm.client_id.trim(),
                    ...(googleForm.client_secret.trim() ? { client_secret: googleForm.client_secret.trim() } : {}),
                  },
                })
                  .then((updated) => {
                    setGoogleCfg(updated);
                    setGoogleForm((f) => ({ ...f, client_secret: '' }));
                    setGoogleMsg({ text: '✓ guardado; rige en menos de 30 s', ok: true });
                  })
                  .catch((err) => setGoogleMsg({ text: err instanceof Error ? err.message : 'Error', ok: false }));
              }}
            >
              <Field label="Client ID (termina en .apps.googleusercontent.com)">
                <input className={inputClass} value={googleForm.client_id} onChange={(e) => setGoogleForm({ ...googleForm, client_id: e.target.value })} required />
              </Field>
              <Field label="Client Secret">
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="off"
                  placeholder={googleCfg?.has_secret ? 'cargado ✓ — vacio = mantener' : 'GOCSPX-...'}
                  value={googleForm.client_secret}
                  onChange={(e) => setGoogleForm({ ...googleForm, client_secret: e.target.value })}
                />
              </Field>
              <div className="flex items-center gap-2">
                <button className={buttonClass}>Guardar Google</button>
                {googleMsg && (
                  <span className={`text-sm ${googleMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{googleMsg.text}</span>
                )}
              </div>
            </form>
          </Card>
        </div>

        {user.role === 'admin' && (
          <div id="operadores" className="scroll-mt-6">
            <OperatorsSection />
          </div>
        )}
        <div id="perfil" className="scroll-mt-6">
          <ProfileSection />
        </div>
      </main>
    </div>
  );
}
