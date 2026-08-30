'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '../../lib/api';
import { Badge, Card, Field, buttonClass, buttonGhost, dt, inputClass } from '../../lib/ui';

interface Operator {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'agent';
  isActive: boolean;
  lastLoginAt: string | null;
}

type Msg = { text: string; ok: boolean } | null;

/** Mensaje con detalle de campos cuando el API devuelve un 422. */
function errText(e: unknown): string {
  const base = e instanceof Error ? e.message : 'Error';
  if (e instanceof ApiError && e.problem.errors) {
    const campos = Object.entries(e.problem.errors)
      .map(([campo, msgs]) => `${campo} (${msgs.join(', ')})`)
      .join(' · ');
    return `${base}: ${campos}`;
  }
  return base;
}

const ROLE_LABEL: Record<Operator['role'], string> = {
  admin: 'administrador',
  agent: 'agente (solo lectura y soporte)',
};

/** Mi perfil: datos propios + cambio de contrasena del operador logueado. */
export function ProfileSection() {
  const [form, setForm] = useState({ full_name: '', email: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [pwMsg, setPwMsg] = useState<Msg>(null);

  useEffect(() => {
    void api<Operator>('/platform/me')
      .then((me) => setForm({ full_name: me.fullName, email: me.email }))
      .catch(() => undefined);
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('/platform/me', { method: 'PATCH', json: form });
      setMsg({ text: '✓ guardado (si cambiaste el email, es el nuevo login)', ok: true });
    } catch (e) {
      setMsg({ text: errText(e), ok: false });
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next !== pw.repeat) {
      setPwMsg({ text: 'La nueva contrasena y su repeticion no coinciden', ok: false });
      return;
    }
    try {
      await api('/platform/me/password', {
        method: 'POST',
        json: { current_password: pw.current, new_password: pw.next },
      });
      setPw({ current: '', next: '', repeat: '' });
      setPwMsg({
        text: '✓ contrasena cambiada; las sesiones en otros dispositivos se cerraron',
        ok: true,
      });
    } catch (e) {
      setPwMsg({ text: errText(e), ok: false });
    }
  }

  return (
    <Card title="Mi perfil" description="Tus datos de operador del portal. El email es tu usuario de login.">
      <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3" onSubmit={(e) => void saveProfile(e)}>
        <Field label="Nombre completo">
          <input className={inputClass} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
        </Field>
        <Field label="Email (login)">
          <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </Field>
        <div className="flex items-center gap-2">
          <button className={buttonClass}>Guardar</button>
          {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      </form>

      <h3 className="mb-1 mt-5 text-sm font-medium">Cambiar contrasena</h3>
      <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-4" onSubmit={(e) => void changePassword(e)}>
        <Field label="Contrasena actual">
          <input className={inputClass} type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
        </Field>
        <Field label="Nueva (min. 10 caracteres)">
          <input className={inputClass} type="password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
        </Field>
        <Field label="Repetir nueva">
          <input className={inputClass} type="password" minLength={10} value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} required />
        </Field>
        <div className="flex items-center gap-2">
          <button className={buttonClass}>Cambiar</button>
        </div>
      </form>
      {pwMsg && <p className={`mt-2 text-sm ${pwMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{pwMsg.text}</p>}
    </Card>
  );
}

/** Usuarios del portal (solo padmin): alta con contrasena temporal, rol,
 *  activar/desactivar y reinicio de contrasena. */
export function OperatorsSection() {
  const [rows, setRows] = useState<Operator[]>([]);
  const [form, setForm] = useState({ full_name: '', email: '', role: 'admin' as Operator['role'] });
  const [creds, setCreds] = useState<{ email: string; pass: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(() => {
    void api<Operator[]>('/platform/users').then(setRows).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  async function createOperator(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await api<{ user: Operator; temp_password: string }>('/platform/users', {
        method: 'POST',
        json: form,
      });
      setCreds({ email: res.user.email, pass: res.temp_password });
      setForm({ full_name: '', email: '', role: 'admin' });
      load();
    } catch (e) {
      setMsg({ text: errText(e), ok: false });
    }
  }

  async function patch(id: string, json: Record<string, unknown>) {
    setMsg(null);
    try {
      await api(`/platform/users/${id}`, { method: 'PATCH', json });
      load();
    } catch (e) {
      setMsg({ text: errText(e), ok: false });
    }
  }

  async function resetPassword(u: Operator) {
    setMsg(null);
    try {
      const res = await api<{ email: string; temp_password: string }>(
        `/platform/users/${u.id}/reset-password`,
        { method: 'POST', json: {} },
      );
      setCreds({ email: res.email, pass: res.temp_password });
    } catch (e) {
      setMsg({ text: errText(e), ok: false });
    }
  }

  return (
    <Card
      title="Usuarios del portal"
      description="Operadores de ESTE panel (no confundir con los usuarios de cada tenant). El administrador gestiona todo; el agente solo lee y da soporte. El alta genera una contrasena temporal que se muestra una unica vez."
    >
      {creds && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">Credenciales (se muestran UNA sola vez):</p>
          <p className="mt-1 font-mono">
            {creds.email} / {creds.pass}
          </p>
          <button className="mt-2 text-amber-700 underline" onClick={() => setCreds(null)}>
            Entendido, ocultar
          </button>
        </div>
      )}
      {msg && <p className={`mb-2 text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}

      <form className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-4" onSubmit={(e) => void createOperator(e)}>
        <Field label="Nombre completo">
          <input className={inputClass} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
        </Field>
        <Field label="Email (para login)">
          <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </Field>
        <Field label="Rol">
          <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Operator['role'] })}>
            <option value="admin">Administrador</option>
            <option value="agent">Agente</option>
          </select>
        </Field>
        <div>
          <button className={buttonClass}>Crear usuario</button>
        </div>
      </form>

      <div className="-mx-4 overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Ultimo acceso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td>{u.fullName}</td>
                <td>{u.email}</td>
                <td>
                  <select
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                    value={u.role}
                    onChange={(e) => void patch(u.id, { role: e.target.value })}
                  >
                    <option value="admin">administrador</option>
                    <option value="agent">agente</option>
                  </select>
                </td>
                <td>
                  <Badge tone={u.isActive ? 'emerald' : 'red'}>{u.isActive ? 'activo' : 'inactivo'}</Badge>
                </td>
                <td>{u.lastLoginAt ? dt(u.lastLoginAt) : 'nunca'}</td>
                <td className="text-right">
                  <span className="inline-flex gap-1">
                    <button className={buttonGhost} onClick={() => void resetPassword(u)}>
                      Reiniciar contrasena
                    </button>
                    <button className={buttonGhost} onClick={() => void patch(u.id, { is_active: !u.isActive })}>
                      {u.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Tu propio usuario se edita desde &quot;Mi perfil&quot; (rol {ROLE_LABEL.admin}: no podes
        desactivarte a vos mismo).
      </p>
    </Card>
  );
}
