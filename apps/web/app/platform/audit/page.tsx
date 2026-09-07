'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { CAMPO, ENTIDAD, describirAccion } from '../../../lib/acciones';
import { api } from '../../../lib/api';
import { useToast } from '../../../lib/feedback';
import { errorMessage, roleLabel } from '../../../lib/labels';
import { Badge, Button, EmptyRow, ErrorNote, LoadMore, PageHeader, Tabs, buttonGhost, dt, inputClass, tableCard, useUrlParam } from '../../../lib/ui';

// Auditoria de seguridad (pedido de Johan 2026-09-07): quien hizo que, desde
// donde y cuando, en los paneles de los clientes y en este portal; y para
// cada accion, los cambios que produjo en la base con estado anterior y nuevo.
// Las contraseñas y tokens jamas aparecen (se guardan como "[oculto]").

interface Tenant {
  id: string;
  legalName: string;
  tradeName: string | null;
}
interface Accion {
  id: string;
  at: string;
  requestId: string | null;
  tenantId: string | null;
  tenant_name: string | null;
  actorUserId: string | null;
  actorScope: string;
  actorRole: string | null;
  actorEmail: string | null;
  ip: string | null;
  userAgent: string | null;
  method: string;
  path: string;
  route: string | null;
  status: number;
  durationMs: number;
  body: unknown;
  errorTitle: string | null;
}
interface Cambio {
  id: string;
  actorUserId: string | null;
  actorType: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
  actor?: { id: string; email: string; fullName: string } | null;
}
interface CambioPlataforma {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  detail: unknown;
  createdAt: string;
}

const SCOPE_LABEL: Record<string, string> = { tenant: 'panel del negocio', platform: 'portal admin', anon: 'sin sesión' };
const OP_LABEL: Record<string, string> = { insert: 'alta', update: 'cambio', delete: 'baja' };

function tonoEstado(status: number): 'emerald' | 'amber' | 'red' | 'slate' {
  if (status < 300) return 'emerald';
  if (status === 401 || status === 403 || status === 423) return 'red';
  if (status < 500) return 'amber';
  return 'red';
}

const OCULTAS = new Set(['tenant_id', 'updated_at']);

/** Solo lo que cambio (o todo en altas/bajas), con etiqueta legible. */
function diff(c: Cambio): { campo: string; antes: unknown; despues: unknown }[] {
  const keys = new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})]);
  const out: { campo: string; antes: unknown; despues: unknown }[] = [];
  for (const k of keys) {
    if (OCULTAS.has(k)) continue;
    const a = c.before?.[k];
    const d = c.after?.[k];
    if (c.action.endsWith('.update') && JSON.stringify(a) === JSON.stringify(d)) continue;
    if (c.action.endsWith('.insert') && (d === null || d === undefined)) continue;
    if (c.action.endsWith('.delete') && (a === null || a === undefined)) continue;
    out.push({ campo: CAMPO[k] ?? k.replace(/_/g, ' '), antes: a, despues: d });
  }
  return out;
}

function Valor({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-slate-300">—</span>;
  if (typeof v === 'boolean') return <>{v ? 'sí' : 'no'}</>;
  if (typeof v === 'object') return <code className="break-all text-[11px]">{JSON.stringify(v)}</code>;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return <>{dt(s)}</>;
  return <span className="break-words">{s.length > 160 ? `${s.slice(0, 160)}…` : s}</span>;
}

function TablaDiff({ c }: { c: Cambio }) {
  const filas = diff(c);
  if (filas.length === 0) return <p className="text-xs text-slate-400">Sin diferencias visibles (solo campos técnicos).</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="py-1 pr-2 font-medium">Campo</th>
          <th className="py-1 pr-2 font-medium">Antes</th>
          <th className="py-1 font-medium">Después</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.campo} className="border-t border-slate-100 align-top">
            <td className="py-1 pr-2 text-slate-500">{f.campo}</td>
            <td className="py-1 pr-2 text-red-700">
              <Valor v={f.antes} />
            </td>
            <td className="py-1 text-emerald-700">
              <Valor v={f.despues} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CambioItem({ c }: { c: Cambio }) {
  const [abierto, setAbierto] = useState(false);
  const op = c.action.split('.').pop() ?? '';
  return (
    <li className="rounded-md border border-slate-200 bg-white p-2">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left text-sm" onClick={() => setAbierto(!abierto)}>
        <Badge tone={op === 'delete' ? 'red' : op === 'insert' ? 'emerald' : 'sky'}>{OP_LABEL[op] ?? op}</Badge>
        <span className="font-medium">{ENTIDAD[c.entity] ?? c.entity}</span>
        {c.entityId && <span className="font-mono text-[11px] text-slate-400">{c.entityId.slice(0, 8)}…</span>}
        {c.actor && <span className="text-xs text-slate-500">· {c.actor.email}</span>}
        {c.actorType !== 'user' && <span className="text-xs text-slate-400">· {c.actorType}</span>}
        <span className="ml-auto text-xs text-slate-400">{dt(c.createdAt)}</span>
      </button>
      {abierto && (
        <div className="mt-2">
          <TablaDiff c={c} />
        </div>
      )}
    </li>
  );
}

// ------------------------------ Acciones ------------------------------

function Acciones({ tenants, tenantInicial }: { tenants: Tenant[]; tenantInicial: string }) {
  const toast = useToast();
  const [f, setF] = useState({ tenant_id: tenantInicial, actor: '', q: '', from: '', to: '', only_errors: false, scope: '' });
  const [rows, setRows] = useState<Accion[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Record<string, { changes: Cambio[]; platform_changes: CambioPlataforma[] } | null>>({});

  const query = useCallback(
    (c?: string | null) => {
      const p = new URLSearchParams({ limit: '50' });
      if (f.tenant_id) p.set('tenant_id', f.tenant_id);
      if (f.actor.trim()) p.set('actor', f.actor.trim());
      if (f.q.trim()) p.set('q', f.q.trim());
      if (f.from) p.set('from', new Date(`${f.from}T00:00:00`).toISOString());
      if (f.to) p.set('to', new Date(`${f.to}T23:59:59`).toISOString());
      if (f.only_errors) p.set('only_errors', 'true');
      if (f.scope) p.set('scope', f.scope);
      if (c) p.set('cursor', c);
      return p.toString();
    },
    [f],
  );

  const load = useCallback(() => {
    setCargando(true);
    api<{ data: Accion[]; next_cursor: string | null }>(`/platform/audit/actions?${query()}`)
      .then((r) => {
        setRows(r.data);
        setCursor(r.next_cursor);
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setCargando(false));
  }, [query]);
  useEffect(() => load(), [load]);

  function mas() {
    if (!cursor) return;
    setCargando(true);
    api<{ data: Accion[]; next_cursor: string | null }>(`/platform/audit/actions?${query(cursor)}`)
      .then((r) => {
        setRows((prev) => [...(prev ?? []), ...r.data]);
        setCursor(r.next_cursor);
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setCargando(false));
  }

  async function abrir(a: Accion) {
    if (abierta === a.id) {
      setAbierta(null);
      return;
    }
    setAbierta(a.id);
    if (detalle[a.id] === undefined) {
      try {
        const d = await api<{ changes: Cambio[]; platform_changes: CambioPlataforma[] }>(`/platform/audit/actions/${a.id}`);
        setDetalle((prev) => ({ ...prev, [a.id]: { changes: d.changes, platform_changes: d.platform_changes } }));
      } catch (e) {
        toast.error(errorMessage(e));
        setDetalle((prev) => ({ ...prev, [a.id]: null }));
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-500">
          Cliente
          <select className={`${inputClass} mt-0.5 min-w-[200px]`} value={f.tenant_id} onChange={(e) => setF({ ...f, tenant_id: e.target.value })}>
            <option value="">Todos (incluye portal admin)</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tradeName ?? t.legalName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Usuario (email)
          <input className={`${inputClass} mt-0.5 w-48`} placeholder="parte del email" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          Buscar (acción, IP, trace_id)
          <input className={`${inputClass} mt-0.5 w-56`} placeholder="ej: invoices, 192.168, trace_id" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          Desde
          <input className={`${inputClass} mt-0.5 w-36`} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          Hasta
          <input className={`${inputClass} mt-0.5 w-36`} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          Origen
          <select className={`${inputClass} mt-0.5`} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
            <option value="">Todos</option>
            <option value="tenant">Panel del negocio</option>
            <option value="platform">Portal admin</option>
            <option value="anon">Sin sesión (logins, rechazos)</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" checked={f.only_errors} onChange={(e) => setF({ ...f, only_errors: e.target.checked })} />
          Solo errores y rechazos
        </label>
      </div>

      <div className={tableCard}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Cliente</th>
              <th>Usuario</th>
              <th>IP</th>
              <th>Acción</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((a) => {
              const d = detalle[a.id];
              return (
                <Fragmento key={a.id}>
                  <tr className={`cursor-pointer ${abierta === a.id ? 'bg-sky-50' : 'hover:bg-slate-50'}`} onClick={() => void abrir(a)}>
                    <td className="whitespace-nowrap text-xs">{dt(a.at)}</td>
                    <td className="text-xs">
                      {a.tenant_name ? (
                        <Link className="text-sky-700 hover:underline" href={`/platform/tenants/${a.tenantId}`} onClick={(e) => e.stopPropagation()}>
                          {a.tenant_name}
                        </Link>
                      ) : (
                        <span className="text-slate-400">{a.actorScope === 'platform' ? 'Portal admin' : '—'}</span>
                      )}
                    </td>
                    <td className="text-xs">
                      {a.actorEmail ? <span className="font-mono">{a.actorEmail}</span> : <span className="text-slate-400">{SCOPE_LABEL[a.actorScope]}</span>}
                      {a.actorRole && <span className="block text-slate-400">{roleLabel(a.actorRole)}</span>}
                    </td>
                    <td className="font-mono text-xs">{a.ip ?? '—'}</td>
                    <td>
                      <span className="text-sm">{describirAccion(a.method, a.route, a.path)}</span>
                      <span className="block font-mono text-[11px] text-slate-400">
                        {a.method} {a.path}
                      </span>
                    </td>
                    <td>
                      <Badge tone={tonoEstado(a.status)}>{a.status}</Badge>
                      {a.errorTitle && <span className="block max-w-[16rem] truncate text-xs text-red-700" title={a.errorTitle}>{a.errorTitle}</span>}
                      <span className="block text-[11px] text-slate-400">{a.durationMs} ms</span>
                    </td>
                  </tr>
                  {abierta === a.id && (
                    <tr className="bg-sky-50/60">
                      <td colSpan={6} className="p-3">
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Datos del pedido</p>
                            <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5 text-xs">
                              <dt className="text-slate-400">Identificador</dt>
                              <dd className="font-mono break-all">{a.requestId ?? '—'}</dd>
                              <dt className="text-slate-400">Navegador</dt>
                              <dd className="break-all text-slate-600">{a.userAgent ?? '—'}</dd>
                              <dt className="text-slate-400">Ruta</dt>
                              <dd className="font-mono">{a.route ?? a.path}</dd>
                            </dl>
                            <p className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">Datos enviados (contraseñas y tokens ocultos)</p>
                            <pre className="max-h-64 overflow-auto rounded-md bg-slate-900 p-2 text-[11px] text-slate-100">{a.body ? JSON.stringify(a.body, null, 2) : '(sin cuerpo)'}</pre>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Cambios en la base (antes → después)</p>
                            {d === undefined && <p className="text-xs text-slate-400">Cargando…</p>}
                            {d === null && <p className="text-xs text-red-700">No se pudieron cargar los cambios.</p>}
                            {d && d.changes.length === 0 && d.platform_changes.length === 0 && (
                              <p className="text-xs text-slate-400">Sin cambios registrados para este pedido {a.status >= 400 ? '(terminó con error)' : ''}.</p>
                            )}
                            {d && d.changes.length > 0 && (
                              <ul className="space-y-1.5">
                                {d.changes.map((c) => (
                                  <CambioItem key={c.id} c={c} />
                                ))}
                              </ul>
                            )}
                            {d && d.platform_changes.length > 0 && (
                              <ul className="mt-2 space-y-1 text-xs">
                                {d.platform_changes.map((c) => (
                                  <li key={c.id} className="rounded-md border border-slate-200 bg-white p-2">
                                    <span className="font-medium">{c.action}</span> <span className="text-slate-400">· {c.entity}</span>
                                    {c.detail ? <pre className="mt-1 overflow-auto text-[11px] text-slate-600">{JSON.stringify(c.detail, null, 1)}</pre> : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragmento>
              );
            })}
            {rows && rows.length === 0 && <EmptyRow colSpan={6}>Ninguna acción coincide con los filtros.</EmptyRow>}
            {rows === null && <EmptyRow colSpan={6}>Cargando…</EmptyRow>}
          </tbody>
        </table>
        <LoadMore nextCursor={cursor} loading={cargando} onLoad={mas} />
      </div>
    </div>
  );
}

function Fragmento({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ------------------------------ Cambios por registro ------------------------------

function Cambios({ tenants, tenantInicial }: { tenants: Tenant[]; tenantInicial: string }) {
  const toast = useToast();
  const [f, setF] = useState({ tenant_id: tenantInicial || tenants[0]?.id || '', entity: '', entity_id: '', from: '', to: '' });
  const [rows, setRows] = useState<Cambio[] | null>(null);
  const [entities, setEntities] = useState<{ entity: string; count: number }[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (c?: string | null) => {
      const p = new URLSearchParams({ tenant_id: f.tenant_id, limit: '50' });
      if (f.entity) p.set('entity', f.entity);
      if (/^[0-9a-f-]{36}$/i.test(f.entity_id.trim())) p.set('entity_id', f.entity_id.trim());
      if (f.from) p.set('from', new Date(`${f.from}T00:00:00`).toISOString());
      if (f.to) p.set('to', new Date(`${f.to}T23:59:59`).toISOString());
      if (c) p.set('cursor', c);
      return p.toString();
    },
    [f],
  );

  const load = useCallback(() => {
    if (!f.tenant_id) {
      setRows([]);
      return;
    }
    setCargando(true);
    api<{ data: Cambio[]; next_cursor: string | null; entities: { entity: string; count: number }[] }>(`/platform/audit/changes?${query()}`)
      .then((r) => {
        setRows(r.data);
        setCursor(r.next_cursor);
        setEntities(r.entities);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setCargando(false));
  }, [query, f.tenant_id]);
  useEffect(() => load(), [load]);

  function mas() {
    if (!cursor) return;
    setCargando(true);
    api<{ data: Cambio[]; next_cursor: string | null }>(`/platform/audit/changes?${query(cursor)}`)
      .then((r) => {
        setRows((prev) => [...(prev ?? []), ...r.data]);
        setCursor(r.next_cursor);
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setCargando(false));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-500">
          Cliente *
          <select className={`${inputClass} mt-0.5 min-w-[200px]`} value={f.tenant_id} onChange={(e) => setF({ ...f, tenant_id: e.target.value, entity: '' })}>
            <option value="">Elegí un cliente…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tradeName ?? t.legalName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Qué
          <select className={`${inputClass} mt-0.5 min-w-[180px]`} value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
            <option value="">Todo</option>
            {entities.map((e) => (
              <option key={e.entity} value={e.entity}>
                {ENTIDAD[e.entity] ?? e.entity} ({e.count})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          Id del registro
          <input className={`${inputClass} mt-0.5 w-72 font-mono`} placeholder="uuid (de la URL de la ficha, del turno…)" value={f.entity_id} onChange={(e) => setF({ ...f, entity_id: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          Desde
          <input className={`${inputClass} mt-0.5 w-36`} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">
          Hasta
          <input className={`${inputClass} mt-0.5 w-36`} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </label>
      </div>
      <ErrorNote error={error} />
      <ul className="space-y-1.5">
        {(rows ?? []).map((c) => (
          <CambioItem key={c.id} c={c} />
        ))}
        {rows && rows.length === 0 && <li className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">{f.tenant_id ? 'Sin cambios registrados con esos filtros.' : 'Elegí un cliente para ver sus cambios.'}</li>}
      </ul>
      {cursor && (
        <div className="flex justify-center">
          <Button variant="ghost" loading={cargando} onClick={mas}>
            Cargar más
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AuditoriaPage() {
  const [vista, setVista] = useUrlParam('vista', 'acciones');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const tenantInicial = useMemo(() => (typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('tenant_id') ?? '')), []);

  useEffect(() => {
    void api<Tenant[]>('/platform/tenants')
      .then((t) => setTenants([...t].sort((a, b) => (a.tradeName ?? a.legalName).localeCompare(b.tradeName ?? b.legalName))))
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Auditoría"
        description="Quién hizo qué, desde qué IP y cuándo, en los paneles de los clientes y en este portal, con el estado anterior y nuevo de cada dato que cambió. Las contraseñas y los tokens nunca se guardan. El trace_id de un error es el identificador de su acción acá."
        actions={
          <Link className={buttonGhost} href="/platform/audit">
            Limpiar filtros
          </Link>
        }
      />
      <Tabs value={vista} onChange={setVista} items={[{ key: 'acciones', label: 'Acciones' }, { key: 'cambios', label: 'Cambios por registro' }]} />
      {vista === 'acciones' ? <Acciones tenants={tenants} tenantInicial={tenantInicial} /> : <Cambios tenants={tenants} tenantInicial={tenantInicial} />}
    </div>
  );
}
