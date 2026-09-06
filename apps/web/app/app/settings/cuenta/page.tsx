'use client';

import { useSession } from '../../../../lib/ui';
import { PasswordSection } from '../password';

/** Mi cuenta: la contraseña de quien está usando el panel (cualquier rol). */
export default function CuentaPage() {
  const user = useSession('tenant');
  if (!user) return null;
  return <PasswordSection email={user.email} />;
}
