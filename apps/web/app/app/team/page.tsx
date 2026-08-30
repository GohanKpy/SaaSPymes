'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import {
  Badge,
  Card,
  ErrorNote,
  Field,
  PageHeader,
  buttonClass,
  buttonDanger,
  buttonGhost,
  inputClass,
  useSession,
} from '../../../lib/ui';

interface Branch {
  id: string;
  name: string;
}
interface TeamUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  branchAccess: { branchId: string }[];
}

// Equipo del negocio: el root/admin da de alta cuentas para su personal,
// reinicia contrasenas y desactiva accesos (doc 04 §2, API /users).
export default function TeamPage() {
  const user = useSession('tenant');
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ email: string; pass: string } | null>(null);
  const [form, setForm] = useState({ email: '', full_name: '', role: 'staff', branch_ids: [] as string[] });

  const load = useCallback(() => {
    void api<TeamUser[]>('/users').then(setUsers).catch((e) => setError(String(e.message)));
    void api<Branch[]>('/branches').then(setBranches).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<TeamUser & { temp_password: string }>('/users', {
        method: 'POST',
        json: form,
      });
      setCreds({ email: res.email, pass: res.temp_password });
      setForm({ email: '', full_name: '', role: 'staff', branch_ids: [] });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function toggleActive(u: TeamUser) {
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', json: { is_active: !u.isActive } });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function resetPassword(u: TeamUser) {
    if (!confirm(`Generar una contrasena nueva para ${u.email}? Sus sesiones activas se cierran.`)) return;
    try {
      const res = await api<{ email: string; temp_password: string }>(`/users/${u.id}/reset-password`, {
        method: 'POST',
      });
      setCreds({ email: res.email, pass: res.temp_password });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function removeUser(u: TeamUser) {
    if (!confirm(`Eliminar la cuenta de ${u.email}? Deja de poder entrar al sistema.`)) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  if (!user) return null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipo"
        description="Cuentas de acceso al panel para tu personal: alta, roles, contraseñas y desactivación."
      />
      <ErrorNote error={error} />

      {creds && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">Credenciales (se muestran UNA sola vez, pasalas a la persona):</p>
          <p className="mt-1 font-mono">
            {creds.email} / {creds.pass}
          </p>
          <button className="mt-2 text-amber-700 underline" onClick={() => setCreds(null)}>
            Entendido, ocultar
          </button>
        </div>
      )}

      <Card title="Nueva cuenta para tu personal">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4" onSubmit={(e) => void createUser(e)}>
          <Field label="Email">
            <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Nombre completo">
            <input className={inputClass} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
          </Field>
          <Field label="Rol">
            <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="staff">Staff (atiende y agenda)</option>
              <option value="admin">Admin (gestiona el negocio)</option>
            </select>
          </Field>
          <div className="flex items-end">
            <button className={buttonClass}>Crear cuenta</button>
          </div>
          {branches.length > 1 && (
            <div className="sm:col-span-2 md:col-span-4">
              <Field label="Sucursales con acceso (vacio = todas)">
                <div className="flex flex-wrap gap-3">
                  {branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={form.branch_ids.includes(b.id)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            branch_ids: e.target.checked
                              ? [...form.branch_ids, b.id]
                              : form.branch_ids.filter((id) => id !== b.id),
                          })
                        }
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          )}
        </form>
      </Card>

      <Card title="Cuentas del negocio">
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Email</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Ultimo acceso</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.isActive ? 'hover:bg-slate-50' : 'opacity-50'}>
                  <td className="font-mono text-xs">{u.email}</td>
                  <td>{u.fullName}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <Badge tone={u.role === 'root' ? 'violet' : u.role === 'admin' ? 'sky' : 'slate'}>{u.role}</Badge>
                      {!u.isActive && <Badge tone="red">inactivo</Badge>}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'nunca'}
                  </td>
                  <td className="text-right">
                    <span className="inline-flex gap-1">
                      <button className={buttonGhost} onClick={() => void resetPassword(u)}>
                        Reiniciar contrasena
                      </button>
                      {u.role !== 'root' && (
                        <>
                          <button className={buttonGhost} onClick={() => void toggleActive(u)}>
                            {u.isActive ? 'Desactivar' : 'Reactivar'}
                          </button>
                          <button className={buttonDanger} onClick={() => void removeUser(u)}>
                            Eliminar
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
