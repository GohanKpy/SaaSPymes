'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { OneTimeCredentials } from '../../../lib/credentials';
import { useConfirm, useToast } from '../../../lib/feedback';
import { errorMessage, roleLabel } from '../../../lib/labels';
import { Badge, Button, EmptyRow, Field, Modal, buttonDanger, buttonGhost, dt, inputClass, tableCard } from '../../../lib/ui';

// Accesos al panel (antes "Equipo", fase 2 auditoria de paneles 2026-09-05):
// las cuentas con las que tu gente entra al sistema. Vive como pestaña de
// Personal, junto a las fichas, y se puede crear una cuenta desde la ficha
// del empleado con sus datos ya puestos.

interface Branch {
  id: string;
  name: string;
}
export interface TeamUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  branchAccess: { branchId: string }[];
}
export interface Prefill {
  email: string;
  full_name: string;
}

const ROLE_TONE: Record<string, 'violet' | 'sky' | 'slate'> = { root: 'violet', admin: 'sky', staff: 'slate' };

export function AccesosSection({ prefill, onPrefillUsed, onUsers }: { prefill: Prefill | null; onPrefillUsed: () => void; onUsers?: (users: TeamUser[]) => void }) {
  const confirmar = useConfirm();
  const toast = useToast();
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [creds, setCreds] = useState<{ email: string; pass: string } | null>(null);
  const [nueva, setNueva] = useState(false);
  const [form, setForm] = useState({ email: '', full_name: '', role: 'staff', branch_ids: [] as string[] });
  const [guardando, setGuardando] = useState(false);

  const load = useCallback(() => {
    api<TeamUser[]>('/users')
      .then((u) => {
        setUsers(u);
        onUsers?.(u);
      })
      .catch((e) => toast.error(errorMessage(e)));
    void api<Branch[]>('/branches').then(setBranches).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  useEffect(() => {
    if (prefill) {
      setForm({ email: prefill.email, full_name: prefill.full_name, role: 'staff', branch_ids: [] });
      setNueva(true);
      onPrefillUsed();
    }
  }, [prefill]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const res = await api<TeamUser & { temp_password: string }>('/users', { method: 'POST', json: form });
      setCreds({ email: res.email, pass: res.temp_password });
      setNueva(false);
      setForm({ email: '', full_name: '', role: 'staff', branch_ids: [] });
      toast.success(`Cuenta creada para ${res.fullName}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActive(u: TeamUser) {
    if (u.isActive) {
      const ok = await confirmar({
        title: `Desactivar la cuenta de ${u.fullName}`,
        message: 'No va a poder entrar al panel hasta que la reactives. Sus datos y su historial se conservan.',
        confirmLabel: 'Desactivar',
      });
      if (!ok) return;
    }
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', json: { is_active: !u.isActive } });
      toast.success(u.isActive ? 'Cuenta desactivada' : 'Cuenta reactivada');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function resetPassword(u: TeamUser) {
    const ok = await confirmar({
      title: `Generar una contraseña nueva para ${u.fullName}`,
      message: 'La contraseña actual deja de servir y sus sesiones abiertas se cierran. La nueva se muestra una sola vez: copiala y pasásela.',
      confirmLabel: 'Generar contraseña',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      const res = await api<{ email: string; temp_password: string }>(`/users/${u.id}/reset-password`, { method: 'POST' });
      setCreds({ email: res.email, pass: res.temp_password });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function removeUser(u: TeamUser) {
    const ok = await confirmar({
      title: `Eliminar la cuenta de ${u.fullName}`,
      message: 'Deja de poder entrar al sistema. Si solo querés frenar el acceso un tiempo, usá Desactivar.',
      confirmLabel: 'Eliminar cuenta',
    });
    if (!ok) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      toast.success('Cuenta eliminada');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      {creds && <OneTimeCredentials title="Datos de acceso al panel:" email={creds.email} password={creds.pass} onHide={() => setCreds(null)} />}

      <div className={tableCard}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
          <p className="text-sm text-slate-500">Con estas cuentas tu gente entra al panel. Las fichas de la pestaña anterior son otra cosa: quién trabaja y atiende.</p>
          <Button
            variant="primary"
            onClick={() => {
              setForm({ email: '', full_name: '', role: 'staff', branch_ids: [] });
              setNueva(true);
            }}
          >
            Nueva cuenta
          </Button>
        </div>
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
            {(users ?? []).map((u) => (
              <tr key={u.id} className={u.isActive ? 'hover:bg-slate-50' : 'text-slate-400'}>
                <td className="font-medium">{u.fullName}</td>
                <td className="font-mono text-xs">{u.email}</td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <Badge tone={ROLE_TONE[u.role] ?? 'slate'}>{roleLabel(u.role)}</Badge>
                    {!u.isActive && <Badge tone="red">desactivada</Badge>}
                  </span>
                </td>
                <td className="text-xs text-slate-500">{u.lastLoginAt ? dt(u.lastLoginAt) : 'nunca entró'}</td>
                <td className="text-right">
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    <button className={buttonGhost} onClick={() => void resetPassword(u)}>
                      Nueva contraseña
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
            {users && users.length === 0 && <EmptyRow colSpan={5}>Solo existe tu cuenta de dueño. Creá una por cada persona que necesite entrar al panel.</EmptyRow>}
            {users === null && <EmptyRow colSpan={5}>Cargando…</EmptyRow>}
          </tbody>
        </table>
      </div>

      {nueva && (
        <Modal
          title="Nueva cuenta de acceso"
          description="La persona recibe una contraseña temporal que se muestra una sola vez; después la cambia desde Ajustes → Mi cuenta."
          onClose={() => setNueva(false)}
        >
          <form className="space-y-3" onSubmit={(e) => void createUser(e)}>
            <Field label="Nombre completo *">
              <input className={inputClass} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required autoFocus />
            </Field>
            <Field label="Email (va a ser su usuario) *">
              <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label="Qué puede hacer">
              <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Personal: agenda, chat, clientes y facturación</option>
                <option value="admin">Administrador: además catálogo, personal y ajustes del negocio</option>
              </select>
            </Field>
            {branches.length > 1 && (
              <Field label="Sucursales que puede ver (ninguna marcada = todas)">
                <div className="flex flex-wrap gap-3">
                  {branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={form.branch_ids.includes(b.id)}
                        onChange={(e) =>
                          setForm({ ...form, branch_ids: e.target.checked ? [...form.branch_ids, b.id] : form.branch_ids.filter((id) => id !== b.id) })
                        }
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNueva(false)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando}>
                Crear cuenta
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
