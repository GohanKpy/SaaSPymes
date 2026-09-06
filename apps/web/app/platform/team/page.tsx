'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { api } from '../../../lib/api';
import { OneTimeCredentials } from '../../../lib/credentials';
import { useConfirm, useToast } from '../../../lib/feedback';
import { errorMessage, roleLabel } from '../../../lib/labels';
import { Badge, Button, EmptyRow, ErrorNote, Field, Modal, PageHeader, buttonGhost, dt, inputClass, tableCard, useSession } from '../../../lib/ui';

// Usuarios del portal (fase 3 auditoria de paneles 2026-09-05): los
// operadores de ESTE panel, no los usuarios de cada cliente. Solo el rol
// administrador entra aca; el agente lee y da soporte.

interface Operator {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'agent';
  isActive: boolean;
  lastLoginAt: string | null;
}

export default function UsuariosPortalPage() {
  const router = useRouter();
  const user = useSession('platform');
  const confirmar = useConfirm();
  const toast = useToast();
  const [rows, setRows] = useState<Operator[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ email: string; pass: string } | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', role: 'agent' as Operator['role'] });
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (user && user.role !== 'admin') router.replace('/platform');
  }, [user, router]);

  const load = useCallback(() => {
    api<Operator[]>('/platform/users')
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'No se pudieron cargar los usuarios del portal.')));
  }, []);
  useEffect(() => load(), [load]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const res = await api<{ user: Operator; temp_password: string }>('/platform/users', { method: 'POST', json: form });
      setCreds({ email: res.user.email, pass: res.temp_password });
      setForm({ full_name: '', email: '', role: 'agent' });
      setNuevo(false);
      toast.success(`Usuario ${res.user.fullName} creado`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarRol(u: Operator, role: Operator['role']) {
    if (role === u.role) return;
    try {
      await api(`/platform/users/${u.id}`, { method: 'PATCH', json: { role } });
      toast.success(`${u.fullName} ahora es ${roleLabel(role)}`);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function toggleActivo(u: Operator) {
    if (u.isActive) {
      const ok = await confirmar({
        title: `Desactivar a ${u.fullName}`,
        message: 'No va a poder entrar al portal hasta que lo reactives. Queda registrado en la auditoría.',
        confirmLabel: 'Desactivar',
      });
      if (!ok) return;
    }
    try {
      await api(`/platform/users/${u.id}`, { method: 'PATCH', json: { is_active: !u.isActive } });
      toast.success(u.isActive ? `${u.fullName} desactivado` : `${u.fullName} reactivado`);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function nuevaContrasena(u: Operator) {
    const ok = await confirmar({
      title: `Generar una contraseña nueva para ${u.fullName}`,
      message: 'La actual deja de servir y sus sesiones abiertas se cierran. La nueva se muestra una sola vez.',
      confirmLabel: 'Generar contraseña',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      const res = await api<{ email: string; temp_password: string }>(`/platform/users/${u.id}/reset-password`, { method: 'POST', json: {} });
      setCreds({ email: res.email, pass: res.temp_password });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (!user || user.role !== 'admin') return null;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Usuarios del portal"
        description="Quiénes entran a ESTE panel. El administrador gestiona todo; el agente solo lee y da soporte. No confundir con los usuarios de cada cliente (están en su ficha)."
        actions={
          <Button variant="primary" onClick={() => setNuevo(true)}>
            Nuevo usuario
          </Button>
        }
      />
      <ErrorNote error={error} />
      {creds && <OneTimeCredentials title="Acceso al portal:" email={creds.email} password={creds.pass} onHide={() => setCreds(null)} />}

      <div className={tableCard}>
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
            {(rows ?? []).map((u) => {
              const soyYo = u.id === user.id;
              return (
                <tr key={u.id} className={u.isActive ? 'hover:bg-slate-50' : 'text-slate-400'}>
                  <td className="font-medium">
                    {u.fullName}
                    {soyYo && <span className="ml-1 text-xs font-normal text-slate-400">(vos)</span>}
                  </td>
                  <td className="font-mono text-xs">{u.email}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      {soyYo ? (
                        <Badge tone="violet">{roleLabel(u.role)}</Badge>
                      ) : (
                        <select className="rounded-md border border-slate-200 px-2 py-1 text-xs" aria-label="Rol" value={u.role} onChange={(e) => void cambiarRol(u, e.target.value as Operator['role'])}>
                          <option value="admin">administrador</option>
                          <option value="agent">agente</option>
                        </select>
                      )}
                      {!u.isActive && <Badge tone="red">desactivado</Badge>}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500">{u.lastLoginAt ? dt(u.lastLoginAt) : 'nunca entró'}</td>
                  <td className="text-right">
                    {soyYo ? (
                      <span className="text-xs text-slate-400">tus datos se editan en Mi perfil</span>
                    ) : (
                      <span className="inline-flex gap-1">
                        <button className={buttonGhost} onClick={() => void nuevaContrasena(u)}>
                          Nueva contraseña
                        </button>
                        <button className={buttonGhost} onClick={() => void toggleActivo(u)}>
                          {u.isActive ? 'Desactivar' : 'Reactivar'}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows && rows.length === 0 && <EmptyRow colSpan={5}>Sin usuarios.</EmptyRow>}
            {rows === null && !error && <EmptyRow colSpan={5}>Cargando…</EmptyRow>}
          </tbody>
        </table>
      </div>

      {nuevo && (
        <Modal title="Nuevo usuario del portal" description="Recibe una contraseña temporal que se muestra una sola vez; después la cambia desde Mi perfil." onClose={() => setNuevo(false)}>
          <form className="space-y-3" onSubmit={(e) => void crear(e)}>
            <Field label="Nombre completo *">
              <input className={inputClass} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required autoFocus />
            </Field>
            <Field label="Email (va a ser su usuario) *">
              <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label="Rol">
              <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Operator['role'] })}>
                <option value="agent">Agente: lee, da soporte y usa el asistente</option>
                <option value="admin">Administrador: gestiona clientes, planes, motor y usuarios</option>
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNuevo(false)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando}>
                Crear usuario
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
