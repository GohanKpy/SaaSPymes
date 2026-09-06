'use client';

import { useToast } from '../../../../lib/feedback';
import { CustomFieldsSection } from '../custom-fields';

/** Campos propios de la ficha de clientes (solo dueño y administrador). */
export default function CamposPage() {
  const toast = useToast();
  return <CustomFieldsSection onError={(msg) => toast.error(msg)} />;
}
