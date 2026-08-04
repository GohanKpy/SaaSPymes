# 10 · AWS Account Organization
## Convivencia de dos proyectos en una cuenta y plan de separación futura

Este documento complementa al 06 (Infrastructure / Deployment). El 06 define **qué** infraestructura necesita el SaaS; este define **dónde vive** y cómo convive con el otro proyecto que ya corre en la misma cuenta de AWS.

---

## 1. Decisión

**[DECISIÓN] Los dos proyectos conviven en la cuenta de AWS ya activa**, separados por VPC, convención de nombres, tags e IAM. La separación en cuentas distintas queda planificada para más adelante (sección 6).

Contexto de la decisión: hay un proyecto ya corriendo en la cuenta y el SaaS de PyMEs arranca de cero. El titular de ambos es el mismo, así que no hay un requisito de separación administrativa o fiscal que obligue a dividir hoy. Se prioriza simplicidad operativa de arranque, asumiendo conscientemente las limitaciones de la sección 5.

**[DESCARTADO por ahora] AWS Organizations con una cuenta por proyecto.** Es la práctica recomendada por AWS: los recursos de trabajo deberían vivir en cuentas miembro y la cuenta de gestión debería quedar sin cargas. Se descarta por ahora, no por costo (Organizations no tiene costo adicional y la facturación llega consolidada) sino por simplicidad de arranque. Se retoma en la sección 6.

Dos datos verificados que conviene dejar asentados para no repetir el análisis:

- **El dominio de correo no es un bloqueante para abrir cuentas.** AWS solo exige un email único por cuenta, y las subdirecciones con signo más (`tucano+saaspymes@dominio.com`) funcionan como direcciones únicas. La propia documentación de AWS sugiere ese patrón de nombres para cuentas miembro.
- **Los créditos de cliente nuevo no aplican en este escenario, por dos motivos independientes.** Primero, el free plan y los créditos son solo para clientes nuevos de AWS: tener o haber tenido una cuenta deja al titular inelegible. Segundo, aunque se obtuvieran, al unir una cuenta a una AWS Organization los créditos expiran de inmediato y el plan gratuito pasa automáticamente a plan pago. Conclusión práctica: al crear cualquier cuenta futura, elegir **plan Paid**, nunca el plan Free (que expira a los 6 meses o al agotarse los créditos, lo que ocurra primero, y restringe los servicios más caros).

---

## 2. Reglas de convivencia (obligatorias antes de crear el primer recurso)

| # | Regla | Por qué |
|---|---|---|
| 1 | **VPC propia por proyecto, con CIDR distintos y sin peering** | Aislamiento de red real dentro de la misma cuenta. CIDR distintos evitan colisiones si alguna vez hay que conectarlas o migrar |
| 2 | **Prefijo de proyecto en el nombre de todo recurso** | Hace evidente de quién es cada cosa en una consola compartida, y permite políticas IAM por prefijo |
| 3 | **Tags obligatorios en todo recurso** | Es la única forma de saber cuánto cuesta cada proyecto por separado |
| 4 | **Cero recursos compartidos entre proyectos** | Es la regla que decide si la separación futura es un fin de semana o un mes |
| 5 | **Un rol IAM por aplicación, con permisos acotados** | Un rol amplio convierte cualquier bug en un incidente que cruza proyectos |
| 6 | **Infraestructura como código con state separado por proyecto** | Un `terraform destroy` jamás puede alcanzar recursos del otro proyecto, y la migración futura se vuelve trivial |

### 2.1 Direccionamiento de red

| Proyecto | CIDR | Nota |
|---|---|---|
| Proyecto existente | por verificar | Si usa la VPC por defecto de AWS, es `172.31.0.0/16` |
| SaaS PyMEs | `10.0.0.0/16` | Definido en el documento 06 |

**Acción previa obligatoria:** verificar el CIDR de la VPC existente antes de aplicar el Terraform del SaaS. Si el proyecto actual ya usa algo dentro de `10.0.0.0/16`, se reasigna el SaaS a `10.1.0.0/16` y se actualiza el documento 06.

### 2.2 Convención de nombres

Patrón: `<proyecto>-<ambiente>-<recurso>`

| Recurso | Ejemplo SaaS |
|---|---|
| VPC | `pymes-prod-vpc` |
| EC2 | `pymes-prod-app` |
| RDS | `pymes-prod-db` |
| Bucket S3 | `pymes-prod-uploads` |
| Cola SQS | `pymes-prod-messages` / `pymes-prod-messages-dlq` |
| Rol IAM | `pymes-prod-api-role` |
| Security group | `pymes-prod-app-sg` |
| Log group | `/pymes/prod/api` |
| Clave KMS (alias) | `alias/pymes-prod-credentials` |
| Parámetros SSM | `/pymes/prod/db/url` (ya definido en documento 06) |

Nota sobre S3: los nombres de bucket son únicos a nivel mundial. Al migrar a otra cuenta no se puede tener el mismo nombre en dos cuentas simultáneamente, así que **el nombre del bucket nunca debe estar fijo en el código**: siempre por variable de entorno.

### 2.3 Tags obligatorios

| Tag | Valores | Uso |
|---|---|---|
| `Project` | `pymes-saas` / `<proyecto existente>` | Separación de costos y filtros |
| `Environment` | `prod` / `staging` / `dev` | Presupuestos y políticas |
| `Owner` | responsable | Contacto ante incidentes |
| `ManagedBy` | `terraform` / `manual` | Detecta recursos creados a mano fuera del código |

Después de aplicar los tags: activarlos como **cost allocation tags** en Billing (tardan hasta 24 h en aparecer en los reportes) y crear un **AWS Budget por proyecto** filtrado por tag `Project`, con alerta al 80% del tope mensual. El costo por proyecto es insumo directo para la definición de precios de los planes del SaaS.

---

## 3. Checklist previo a crear el primer recurso del SaaS

- [ ] Verificar CIDR de la VPC existente y confirmar o ajustar el del SaaS
- [ ] Crear la VPC del SaaS con su propio Terraform y state separado
- [ ] Definir y documentar los prefijos de nombre de ambos proyectos
- [ ] Aplicar tags a los recursos nuevos, y agregarlos a los existentes cuando se toquen
- [ ] Activar cost allocation tags en Billing
- [ ] Crear un AWS Budget por proyecto con alerta
- [ ] Crear los roles IAM del SaaS acotados a recursos con su prefijo
- [ ] Verificar que ningún recurso quede compartido entre proyectos
- [ ] MFA activo en el usuario root de la cuenta y alarma de CloudWatch ante cualquier actividad de root

---

## 4. Aislamiento de IAM entre proyectos

Cada aplicación con su rol, y los permisos acotados por prefijo de nombre o por tag. Ejemplo del criterio (no del policy final):

- El rol de la API del SaaS puede leer y escribir solo en buckets cuyo nombre empieza con `pymes-`, y solo en los parámetros SSM bajo `/pymes/*`.
- Ningún rol de aplicación tiene permisos de administración de la cuenta.
- Los permisos de KMS se otorgan sobre la clave del proyecto, no sobre todas.
- El acceso humano a producción sigue siendo por SSM Session Manager (documento 05), sin SSH abierto.

---

## 5. Limitaciones aceptadas de la cuenta única

Estas son las contrapartidas de la decisión, asumidas conscientemente:

| Limitación | Impacto | Cuándo empieza a doler |
|---|---|---|
| **Cuotas de servicio compartidas** (vCPUs por región, IPs elásticas, etc.) | Si un proyecto crece, consume cuota del otro | Cuando alguno escale de verdad |
| **Radio de explosión común** | Un error grave de IAM o una credencial comprometida alcanza ambos proyectos | Siempre presente; se mitiga con la regla 5 |
| **Sin políticas de servicio (SCP)** | No se pueden poner barandas duras por proyecto, solo por IAM | Cuando haya más de una persona con acceso |
| **Facturación mezclada** | Solo separable por tags, y solo si los tags están bien puestos | Desde el primer mes: por eso la regla 3 es obligatoria |
| **Ruido en la consola** | Todo aparece junto en cada servicio | Desde el día uno; se mitiga con la regla 2 y Resource Groups |

Mitigación adicional recomendada: crear un **Resource Group** por proyecto filtrado por el tag `Project`, para tener una vista consolidada de cada uno en la consola.

---

## 6. Plan de separación futura

**Disparadores para ejecutar la separación** (cualquiera de estos):

- El SaaS empieza a facturar y conviene aislarlo administrativa y fiscalmente.
- Entra otra persona a operar uno de los proyectos y se necesitan permisos duros por cuenta.
- Un proyecto empieza a chocar contra cuotas de servicio.
- Un cliente enterprise exige aislamiento de cuenta.

**Camino recomendado cuando llegue el momento:** habilitar AWS Organizations en modo *All Features* desde una cuenta de gestión limpia, e invitar o crear las cuentas de cada proyecto como cuentas miembro. Dos variantes:

- **Variante A (más simple):** la cuenta actual pasa a ser la de gestión y se crea una cuenta miembro para el SaaS, migrando sus recursos. La cuenta de gestión queda con cargas de trabajo, fuera de la práctica recomendada.
- **Variante B (recomendada):** se crea una cuenta nueva y limpia como cuenta de gestión, y se invita a la cuenta actual como miembro (el proyecto existente no se mueve). Luego se crea la cuenta del SaaS y se migran solo sus recursos. Detalle a tener en cuenta: a las cuentas invitadas no se les crea automáticamente el rol `OrganizationAccountAccessRole` (hay que crearlo a mano), mientras que a las creadas desde la organización sí.

**Qué se migra fácil (si se respetaron las 6 reglas):**

- Toda la infraestructura: apuntar el provider de Terraform a la cuenta nueva y aplicar.
- Imágenes de contenedor: se replican a un ECR de la cuenta nueva.
- Configuración: los parámetros SSM se recrean desde el código.

**Qué requiere trabajo manual igual:**

| Ítem | Procedimiento |
|---|---|
| Datos de RDS | Snapshot compartido con la cuenta destino, copiado y restaurado ahí |
| Objetos de S3 | Bucket nuevo con nombre distinto + replicación o `aws s3 sync`; recordar que el nombre global no se puede reusar simultáneamente |
| Certificados ACM | Se reemiten en la cuenta nueva (no se transfieren) |
| IPs elásticas | No se transfieren entre cuentas: se asignan nuevas y se actualiza el DNS |
| Secretos y claves KMS | Se recrean; las credenciales de tenants se descifran y vuelven a cifrar con la clave nueva (procedimiento con ventana de mantenimiento) |
| CI/CD | Se reapuntan credenciales y destino del deploy |
| DNS | Cloudflare apuntando a la nueva IP o balanceador, con TTL bajado antes del corte |

**Ventana estimada:** un fin de semana de trabajo prolijo si todo está en Terraform y sin recursos compartidos. Semanas de arqueología si no.

**Precondición innegociable:** ejecutar antes un ensayo completo en staging y una prueba de restore del RDS en la cuenta destino (documento 05, sección 9).
