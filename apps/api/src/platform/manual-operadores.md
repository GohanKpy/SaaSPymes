# Manual del sistema — guía completa para el equipo de soporte

Este manual cubre TODO el sistema: qué hace cada pantalla y cada botón, cómo
guiar a un cliente paso a paso, qué significa cada error que puede aparecer y
cómo resolverlo. Es la fuente de respuesta del asistente interno del portal de
administración.

---

## 1. Qué es el sistema

Plataforma de gestión para PyMEs de servicios de Paraguay (peluquerías,
talleres, consultorios, estudios, etc.). Cada negocio cliente tiene su propio
espacio, totalmente separado de los demás. Incluye:

- CRM de clientes finales (los clientes del negocio).
- Catálogo de servicios y productos con precios en guaraníes.
- Agenda de turnos con empleados agendables.
- Bandeja de chat de WhatsApp con un bot de IA que atiende y agenda solo.
- Facturación electrónica (SIFEN) y presupuestos.

### Los dos portales y sus direcciones

| Portal | Quién lo usa | Dirección |
|---|---|---|
| Portal del negocio (clientes) | Los negocios que contratan el sistema | https://client.inicia.com.py |
| Portal de administración | Nosotros (dueño de la plataforma y su equipo) | https://admin.inicia.com.py |

Ambos portales exigen conexión segura (https). Si alguien entra escribiendo
solo "client.inicia.com.py" o con "http://", el sistema lo redirige solo a la
versión segura.

### Roles

**En el portal de administración:**
- `admin` (padmin): todo — crear clientes, planes, precios, acuerdos, motor
  del bot, usuarios del portal.
- `agent` (pagent): solo lectura y soporte — ve clientes y configuración pero
  no puede modificar planes, precios ni el motor.

**En el portal del negocio:**
- `root`: el dueño del negocio. Único que ve integraciones y secretos
  (WhatsApp, Google Calendar, SIFEN). No se puede eliminar.
- `admin`: gestiona todo el negocio menos integraciones.
- `staff`: operación diaria (agenda, chat, clientes).

---

## 2. Portal de administración (admin.inicia.com.py)

Desde el 2026-09-06 el portal tiene un menú lateral fijo y una página por
tema (antes era una sola página larga con anclas; los links viejos con
`#bot`, `#planes`, etc. siguen llevando al lugar correcto):

| Menú | Ruta | Quién |
|---|---|---|
| Clientes (lista y alta) | /platform | admin y agente |
| Ficha de un cliente | /platform/tenants/<id> | admin y agente |
| Planes | /platform/plans | admin y agente |
| Motor del bot (IA) | /platform/settings/bot | admin y agente |
| Seguridad | /platform/settings/seguridad | admin y agente |
| Google Calendar | /platform/settings/google | admin y agente |
| Correo saliente | /platform/settings/mail | admin y agente (guarda solo admin) |
| Auditoría (Seguridad) | /platform/audit | admin y agente |
| Usuarios del portal | /platform/team | solo admin |
| Mi perfil | /platform/profile | todos |

En el celular el menú se abre con el botón ☰ de la barra superior. El
asistente (esta burbuja) está siempre arriba a la derecha.

### 2.1 Entrar

Usuario y contraseña. Tras varios intentos fallidos (10 en 10 minutos por
defecto, configurable en Seguridad) la cuenta queda **bloqueada temporalmente
10 minutos** y aparece "Bloqueado temporalmente por intentos fallidos; proba
mas tarde". Solución: esperar el tiempo de bloqueo y reintentar con la
contraseña correcta. El bloqueo también se limpia si se reinicia el sistema.

### 2.2 Sección Clientes (dar de alta un negocio)

Botón para **crear cliente**: se cargan razón social, nombre de fantasía,
plan, y el email y nombre del dueño (usuario root del negocio).

**MUY IMPORTANTE — credenciales una sola vez:** al crear el cliente, el
sistema muestra el usuario y la contraseña temporal del dueño UNA SOLA VEZ.
Hay que copiarlos en ese momento y pasárselos al cliente por un canal seguro.
Si se pierden, no hay forma de volver a verlos: hay que usar "Reiniciar
contraseña" sobre ese usuario (genera una temporal nueva, también mostrada una
sola vez).

**La ficha de cada cliente** (clic sobre el cliente en la lista) muestra:
- Datos y estado: `trial` (prueba), `active` (activo), `suspended`
  (suspendido: sus usuarios no pueden entrar y ven "La cuenta de la empresa
  esta suspendida"), `closed` (cerrado).
- Plan actual y **acuerdos a medida** (overrides): activar o apagar una
  función puntual para ese cliente sin cambiar su plan. "Volver a lo del
  plan" borra el acuerdo y la función vuelve a heredar del plan.
- **Límite mensual de IA** (presupuesto de tokens del bot): cuánta IA puede
  consumir ese cliente por mes. Al agotarse, su bot deja de responder solo y
  deriva los chats a su equipo hasta el mes siguiente. Si un cliente se queja
  de que "el bot dejó de responder a fin de mes", revisar esto primero.
- Usuarios del negocio, con botón para **reiniciar la contraseña** de
  cualquiera (temporal mostrada una sola vez).

### 2.3 Planes y funciones

Los planes son datos, no código: crear un plan nuevo o cambiar qué funciones
incluye es un formulario, no un desarrollo. Cada función (feature) puede
activarse por plan o por acuerdo a medida por cliente. Si un cliente no ve un
módulo en su panel (por ejemplo Facturación), casi siempre es porque su plan o
un acuerdo lo tiene apagado.

### 2.4 Motor del bot (IA) — configuración global

Configura el cerebro del bot de TODOS los clientes:
- **Proveedor**: OpenAI o Anthropic. **Modelo**: cuál se usa (vacío = el
  económico por defecto del proveedor).
- **Llaves (API keys)**: se cargan acá, cifradas. Nunca se muestran, solo se
  indica si hay una cargada. Si la llave está mal o el proveedor se queda
  **sin crédito**, los bots de todos los clientes dejan de responder con IA y
  mandan el aviso de respaldo (ver sección 6, problema "el bot responde
  siempre lo mismo").
- **Guía de atención estándar**: el texto base de comportamiento de todos los
  bots. Vacío = rige la guía por defecto del sistema.
- **Segundos de espera antes de responder** (por defecto 15): el bot espera
  ese tiempo por si el cliente manda varios mensajes seguidos, y responde una
  sola vez.
- **Aviso de respaldo** (fallback): el mensaje que el bot manda cuando la IA
  falla. Por defecto: "Gracias por tu mensaje! En breve una persona del
  equipo te responde por este mismo chat."
- **Aviso de límite agotado**: el mensaje cuando el cliente agotó su
  presupuesto mensual de IA.

Los cambios rigen en menos de 30 segundos, sin reiniciar nada.

### 2.5 Seguridad

Parámetros del bloqueo de login para todos los portales: cantidad de intentos
fallidos permitidos, en qué ventana de minutos, y cuántos minutos dura el
bloqueo. Por defecto: 10 intentos / 10 minutos / 10 minutos de bloqueo.

### 2.6 Google Calendar (app del sistema)

Acá se carga UNA vez el Client ID y el secreto de la app de Google de la
plataforma. Sin esto, ningún negocio puede conectar su Google Calendar: al
intentarlo ven "La plataforma aun no tiene configurada la app de Google
(avisale al administrador del sistema)". Además, mientras la app de Google
esté en modo prueba, solo cuentas invitadas como testers pueden conectarse.

### 2.6b Correo saliente (SMTP del sistema, 2026-09-07)

Por acá salen los **resúmenes de cuenta y las facturas por email** de todos los
negocios. Servidor, puerto, cifrado, usuario, contraseña (cifrada) y remitente.
Botón "Enviarme un correo de prueba". Sin configurar, en el laboratorio los
correos van a Mailpit (http://localhost:4307) y NO se entregan. Error "No se
pudo enviar: …": credenciales o puerto mal; probar con el botón de prueba.

### 2.6c Auditoría (Seguridad → Auditoría, 2026-09-07)

Para rastrear un problema: quién hizo qué, desde qué IP y cuándo, en los
paneles de los clientes y en este portal, con el **estado anterior y nuevo**
de cada dato que cambió. Las contraseñas y los tokens nunca se guardan
(figuran como "[oculto]").

- **Acciones**: toda operación que cambia algo (crear, editar, borrar,
  emitir, pagar…) y todos los **intentos de login** (exitosos, fallidos,
  bloqueados), con usuario, IP, navegador, resultado y duración. Filtros por
  cliente, usuario, texto, fechas, origen y "solo errores". Al abrir una
  acción se ven los datos que envió y los cambios en la base (antes → después).
- **Cambios por registro**: la historia de un dato puntual (un cliente, un
  turno, una factura) dentro de un cliente: elegir el cliente, el tipo y pegar
  el id del registro (sale en la URL de su ficha).
- **trace_id**: el código que aparece en cualquier mensaje de error del
  sistema es el identificador de esa acción en Auditoría. Pedírselo al usuario
  y buscarlo en el campo "Buscar".
- Las lecturas (ver una lista, descargar un PDF) no se registran; las acciones
  del bot por WhatsApp quedan en los cambios (actor "bot") pero no en la lista
  de acciones.

### 2.7 Usuarios del portal (operadores)

Solo el rol admin los administra. Alta con contraseña temporal mostrada UNA
sola vez. Cada operador cambia su propia contraseña desde "Mi perfil". Un
operador no puede editarse a sí mismo desde la lista ("Tu propio usuario se
edita desde Mi perfil").

---

## 3. Portal del negocio (client.inicia.com.py) — sección por sección

Menú lateral en tres grupos: Operación (Inicio, Chat, Agenda, Tareas), Gestión
(Clientes, Catálogo, Facturación) y Administración (Personal, Ajustes). En el
celular el menú se abre con el botón ☰ de la barra superior. El personal
(rol staff) no ve Personal y en Ajustes solo ve Mi cuenta. Si alguien olvidó
su contraseña, el dueño o un administrador le genera una nueva desde
Personal → Accesos al panel → "Nueva contraseña"; al dueño se la reinicia
el equipo de la plataforma desde su ficha en el portal admin.

### 3.1 Inicio

Tablero con los números del día y del mes del negocio: turnos de hoy,
facturación del mes, clientes nuevos, conversaciones atendidas. Los números se
calculan en la zona horaria del negocio.

### 3.2 Chat (la bandeja)

Todas las conversaciones de WhatsApp (o del chat de prueba) en un solo lugar.

- **Panel de prueba** (arriba): muestra el identificador del negocio y el
  botón "Abrir chat de prueba" para simular ser un cliente sin WhatsApp real.
  Si no aparece, falta cargar el identificador en Ajustes → WhatsApp.
- Lista de conversaciones a la izquierda, con buscador por nombre, teléfono,
  email o documento.
- Estados de una conversación: **bot activo** (el bot responde solo),
  **pausada** (nadie responde automático), **con agente** (la atiende una
  persona), **inactiva** (2 horas sin mensajes; puede generar un resumen
  automático), **cerrada**.
- Etiqueta roja **"Necesita humano"**: el bot no pudo resolver algo o el
  cliente pidió hablar con una persona. Hay que atender ese chat manualmente:
  se escribe en el campo de abajo ("Responder como agente") y el mensaje sale
  por el mismo canal.
- Botón **Pausar bot / Reactivar bot** en cada conversación: pausa solo esa
  conversación, no el bot del negocio.

### 3.3 Agenda

Turnos del negocio, por día y por empleado.

**Quién atiende cada turno (regla desde el 2026-09-08):** todo turno queda
asignado a un empleado con "Atiende clientes con turno" tildado en Personal.

- Sin ningún empleado así, no se puede agendar ni desde la Agenda ni por
  WhatsApp: la Agenda muestra un aviso con link a Personal y el bot deriva a
  una persona. Mensaje: "Para agendar hace falta al menos un empleado que
  atienda clientes con turno: cargalo en Personal."
- "Cualquiera" en el panel (o el cliente no pidió a nadie por chat): el
  sistema elige, entre los que están libres y dentro de su horario a esa
  hora, al que tiene MENOS carga ese día (minutos ya agendados; en empate,
  menos turnos). La respuesta del bot le dice al cliente quién lo atiende.
- Profesional elegido (en el panel o por el cliente en el chat): se verifica
  que esté libre. Si no lo está, el panel directamente no ofrece ese horario
  ("X no tiene horarios libres ese día") y el bot le dice al cliente que esa
  persona no está disponible a esa hora y le ofrece sus otros horarios del
  día u otro profesional. Nunca cambia de profesional ni de horario sin que
  el cliente acepte.

**Filtros de la Agenda (desde el 2026-09-08):** arriba de la lista hay
"Profesional" y "Cliente" (nombre o celular) para encontrar un turno rápido en
un día lleno; funcionan en la vista Lista y en Por profesional. Si no se sabe
el día, "Buscar en los próximos 30 días" lista las coincidencias con un botón
"Ir al día". Desde otras pantallas se puede abrir `/app/schedule?empleado=<id>`.

**Ausencia de un empleado (desde el 2026-09-08):** en Personal → botón
"Ausencia" (o en la Agenda, vista Por profesional → "Ausencia" al lado del
nombre) se registra desde/hasta (o "hasta nuevo aviso") y un motivo. Mientras
dura, esa persona no recibe turnos ni por el panel ni por el bot.

- Si ya tenía clientes agendados en esas fechas, el sistema NO registra nada
  todavía: muestra la lista de turnos afectados (esa es la notificación al
  dueño) y ofrece "Registrar y avisar a los clientes" o "Registrar sin
  avisar".
- Al avisar, cada cliente recibe por WhatsApp (o por email si no tiene
  celular ni avisos por WhatsApp) el mensaje: "<Empleado> no va a poder
  atenderte el <día> a las <hora> (<servicio>). A esa misma hora podría
  atenderte <otros> / no hay otra persona libre. ¿Preferís que te atienda
  otra persona o pasar el turno a otro día? Respondé por acá". El bot resuelve
  la respuesta: reprograma al mismo horario con la persona elegida o busca
  otro día. Queda una tarea por turno en Tareas ("<Empleado> ausente: turno de
  …") y un correo resumen a los emails de aviso del negocio.
- En la Agenda esos turnos aparecen con la etiqueta roja "profesional
  ausente" (y "cliente avisado" si ya se le mandó el mensaje) hasta que se
  reprogramen; el turno sigue a nombre del ausente para que nadie lo pierda
  de vista.
- "Dar de baja" y destildar "Trabaja actualmente" pasan por el mismo flujo con
  TODOS los turnos futuros de esa persona.
- Las ausencias cargadas se ven y se quitan desde el mismo modal.

- Estados de un turno: `pending` (pendiente de confirmar), `confirmed`
  (confirmado), `completed` (completado), `cancelled` (cancelado), `no_show`
  (el cliente no vino).
- Solo se confirman turnos pendientes; un turno cancelado o completado no se
  puede volver a tocar (errores "Solo se confirman turnos pendientes", "El
  turno no se puede cancelar", "El turno no se puede completar").
- **Horarios de atención**: por sucursal, hasta 3 franjas por día (el hueco
  entre franjas es el almuerzo); un día sin franjas queda cerrado. También se
  cargan días cerrados puntuales (feriados, vacaciones).
- Si al cambiar el horario quedan turnos ya agendados fuera del nuevo
  horario, el sistema avisa el conflicto y ofrece: abortar el cambio,
  mantener esos turnos igual, o cancelarlos avisando a los clientes con un
  mensaje (obligatorio escribirlo).
- "Sin empleados libres en ese horario" / "El empleado elegido ya tiene un
  turno en ese horario": otro turno o un evento de Google Calendar ocupa a
  esa(s) persona(s) a esa hora.
- "Ningun empleado agendable trabaja en ese horario" / "El empleado elegido
  no trabaja en ese horario": fuera del horario de atención o del horario
  propio del empleado.
- "Para agendar hace falta al menos un empleado que atienda clientes con
  turno": el negocio no tiene ningún empleado agendable; cargarlo en Personal.
- "El empleado elegido no existe o no es agendable": el empleado está
  dado de baja o no tiene tildado "Atiende clientes con turno" en Personal.

**Varios servicios en un turno (desde el 2026-09-07):** en "Nuevo turno" los
servicios se tildan (uno o varios); en la Agenda solo aparecen los productos
de tipo *servicio* (los ítems no se agendan a mano). La duración total la
calcula el sistema: el servicio más largo cuenta entero y cada otro suma su
"duración cuando se combina" (campo del Catálogo; si está vacío, suma la
completa). Esa duración se puede ajustar a mano antes de buscar horario. Al
reprogramar se conservan los servicios y la duración. "Cobrar" desde la
agenda precarga todos los servicios del turno en la factura.

**Turnos recurrentes (2026-09-07):** en la ficha del cliente se define un
servicio recurrente (servicios, cada semana / cada dos semanas / cada mes,
día y hora, profesional, desde/hasta). El sistema crea el turno con la
anticipación configurada en Ajustes → Horarios → "Turnos recurrentes" (por
defecto 7 días), estado *a confirmar*, marcado "recurrente", y le escribe por
WhatsApp al cliente pidiendo que confirme con **SÍ** o **NO**. Esa respuesta
la resuelve el sistema (no el bot): SÍ confirma, NO cancela, y en la Agenda el
turno muestra "esperando al cliente" mientras no responde. Si el horario ya no
está libre, el turno no se crea y queda una tarea para el dueño con el motivo
(también se ve en la ficha, bajo el recurrente, como "Último intento").
Botón "Generar ahora" no existe en pantalla; el barrido corre cada hora.

### 3.4 Tareas

Bandeja de pendientes del equipo. Se crean a mano desde la ficha de un
cliente, y el sistema crea solas tareas de **seguimiento comercial** cuando
una conversación queda inactiva y el resumen detecta algo pendiente (por
ejemplo "pasar presupuesto"). Cada tarea tiene vencimiento y responsable.

### 3.5 Clientes (el CRM)

- **Alta rápida**: solo nombre y teléfono; el resto se completa después en la
  ficha. Si ya existe alguien con ese teléfono, email o documento, el sistema
  avisa "Ya existe un cliente con ese telefono, email o documento" y ofrece
  ir a la ficha existente (así se evitan duplicados).
- **La ficha completa** de cada cliente: datos personales, empresa y cargo,
  ciudad, origen (de dónde llegó: WhatsApp, Instagram, recomendación, etc.),
  etiquetas, responsable del equipo, puntaje de 1 a 5 estrellas,
  consentimiento de marketing, varios teléfonos/emails/webs con etiqueta
  (trabajo, personal, etc.), campos personalizados del negocio, línea de
  tiempo de notas y tareas, e historial de turnos y facturas.
- Los clientes que escriben por WhatsApp se crean solos con su teléfono; la
  ficha se va completando con lo que el bot registra.
- **Unir duplicados**: fusiona dos fichas del mismo cliente (no se puede unir
  una ficha consigo misma).
- Un cliente con facturas no se elimina; se desactiva ("El cliente tiene
  facturas: desactivar, no borrar").
- **Campos personalizados** (Ajustes): cada negocio define campos propios de
  la ficha (texto, número, fecha, sí/no, lista de opciones, monto, enlace).
  Se desactivan, no se borran, para no perder datos cargados.

**Datos de facturación (2026-09-07):** la ficha tiene la tarjeta "Datos de
facturación (RUC / razón social)": varios por cliente (su empresa, otra
persona), con uno predeterminado que se propone al facturar. El documento del
bloque "Documento y datos personales" es el personal; si no hay datos de
facturación cargados, las facturas salen con ese documento. Error "Ese
documento ya esta cargado en la ficha de este cliente": duplicado, editar el
existente.

**Facturación y avisos (2026-09-07):** en la ficha, bloque "Facturación y
avisos": **Cómo se le factura** (por servicio, o **cuenta mensual**: acumula lo
atendido y lo comprado y se factura todo al cierre) y **Recibe las facturas y
resúmenes por** (WhatsApp o email), además de los avisos por WhatsApp/email.
Con cuenta mensual aparece la tarjeta **Cuenta del mes** (consumos pendientes;
"Agregar consumo" para compras y extras; "Anular" para lo cargado por error) y
la Agenda muestra "En su cuenta del mes" en vez de "Cobrar" al marcar Atendido.

### 3.6 Catálogo

Primero las **categorías**, después los productos.

- Cada producto es de tipo **servicio** (se agenda directo, con duración en
  minutos) o **ítem** (producto/venta; puede requerir una reunión inicial con
  su propia duración).
- Precio en guaraníes, sin decimales. IVA por producto (10, 5 o exenta).
- Fotos y descripción: se pueden cargar al crear y al editar. Foto máximo
  ~350 KB (PNG o JPEG); si es más pesada, achicarla antes.
- Un producto no se borra si está en uso: se desactiva. Una categoría con
  servicios activos no se puede eliminar ("La categoria tiene servicios
  activos"): primero desactivar o mover sus productos.
- **Carga masiva desde Excel (CSV)**: flujo correcto:
  1. Crear TODAS las categorías a mano en el sistema.
  2. Descargar la plantilla CSV (se arma con las categorías reales; si no hay
     ninguna aparece "Crea primero tus categorias en el catalogo").
  3. Completar en Excel las columnas: categoria, nombre, tipo (servicio o
     item), precio, duracion_min, requiere_reunion, reunion_min, iva,
     descripcion. Obligatorias: categoria, nombre y precio.
  4. Subir el archivo: el sistema muestra una vista previa y avisa TODOS los
     errores fila por fila. No se importa nada hasta que todo esté bien (todo
     o nada). Máximo 500 filas por archivo.
  - "El archivo esta vacio: completa la plantilla y volvela a subir": subió
    la plantilla sin filas de datos.
  - Si una categoría del archivo no existe en el sistema, la fila se marca
    con error: crearla primero y volver a subir.

**Duración cuando se combina (2026-09-07):** cada servicio puede tener,
además de su duración, los minutos que suma cuando se hace junto con otro en
el mismo turno (ej: un tratamiento de 60 min que solo agrega 15 si se hace
durante una coloración). Vacío = suma la duración completa.

### 3.7 Facturación

**Facturar a (2026-09-07):** al crear la factura hay que elegir a nombre de
quién sale: una identidad guardada en la ficha del cliente (RUC o cédula +
razón social), su documento personal, u "Otra persona o empresa" cargando los
datos ahí mismo (con la opción de guardarlos en la ficha). Si el cliente no
tiene nada cargado, el formulario pide los datos directamente. Lo elegido
queda congelado en la factura y sale así en el comprobante. Un borrador se
puede cambiar con "Facturar a…"; una emitida no (se anula). Errores:
- "Falta a nombre de quien sale la factura: carga RUC o cedula y nombre desde
  el detalle del borrador": el borrador no tiene receptor (típico de un
  presupuesto convertido cuando el cliente no tenía documento). Solución:
  abrir el detalle → "Cargar datos".
- "Esa identidad fiscal no esta en la ficha del cliente": se eligió una que
  ya fue quitada; volver a elegir.


- Flujo de una factura: **borrador** → **emitir** → queda `approved`
  (aprobada por SIFEN; en el laboratorio el timbrado es de prueba) → se
  registran **pagos** hasta saldarla.
- Solo los borradores se editan o se borran; para corregir una emitida dentro
  de las 48 horas se **anula**; pasadas las 48 horas corresponde nota de
  crédito (todavía no disponible: escalar).
- El **KuDE** (el PDF de la factura) existe solo para facturas aprobadas, y
  pide registrar el pago antes de generarse.
- "Configura los datos de SIFEN (timbrado, establecimiento, punto) antes de
  emitir": faltan los datos fiscales en Ajustes → SIFEN.
- "El pago excede el saldo pendiente": están cargando un pago mayor a lo que
  falta pagar.
- Los totales y el IVA los calcula SIEMPRE el sistema; no se cargan a mano.

**Cuentas del mes (2026-09-07):** tercera pestaña de Facturación. Lista los
clientes con consumos pendientes (total, cantidad, desde cuándo, canal), con
"Ver consumos", "Enviar resumen" (por su canal) y **"Facturar el mes"**: una
sola factura con todos los consumos, a nombre del RUC predeterminado o el que
se elija, con opciones "Emitir ahora" y "Enviar al cliente" (email con el PDF
adjunto; WhatsApp con un link al comprobante que vale 30 días). Abajo, los
**cierres de mes** generados. El cierre automático se configura en Ajustes →
Facturación → "Cuenta mensual: cierre automático" (día 1 a 28; "Facturar
automáticamente" apagado por defecto). En la fecha de cierre el sistema arma el
resumen del mes anterior por cliente, se lo envía, avisa al dueño (tarea en
Tareas + correo a los emails de aviso) y, si está activado, emite y envía la
factura. Una factura emitida también se puede reenviar con "Enviar al
cliente" desde la lista. Errores: "Este cliente no tiene consumos pendientes";
"El cliente no tiene email cargado" / "no tiene celular cargado" (el canal
elegido no tiene dato en la ficha).

### 3.8 Presupuestos

Presupuestos formales sin valor fiscal, numerados P-0001, P-0002…

- Estados: **borrador** → **enviado** → **aceptado** o **rechazado**. Un
  aceptado o rechazado puede volver a "enviado" (por ejemplo si se renegocia).
- Un presupuesto aceptado se **convierte en borrador de factura** con un
  clic. Un rechazado no se factura; uno ya facturado no se factura dos veces.
- Solo los borradores se editan ("Solo los borradores se editan; crea uno
  nuevo") o se borran.
- Se puede descargar en PDF para enviar al cliente.

### 3.9 Personal (ruta /app/employees)

Una sola pantalla con dos pestañas (desde el 2026-09-05; antes eran dos
pantallas separadas, "Empleados" y "Equipo"):

**Pestaña Fichas**: quién trabaja en el negocio.

- Solo nombres y apellidos son obligatorios; el email es opcional.
- **"Atiende clientes con turno"** (agendable): tildar solo para quienes
  reciben turnos en la agenda; el bot ofrece únicamente empleados agendables.
  Hace falta al menos uno: desde el 2026-09-08 todo turno se asigna a un
  empleado y sin agendables no se agenda (ni en el panel ni por WhatsApp).
- **"Ausencia"**: días en que no atiende (licencia, vacaciones, se ausenta).
  Con turnos ya agendados en esas fechas el sistema los lista y ofrece avisar
  a los clientes (ver 3.3, "Ausencia de un empleado"). "Dar de baja" hace lo
  mismo con todos los turnos futuros.
- **"Trabaja actualmente"**: destildar para dar de baja a alguien que ya no
  está (no se borra el historial). El botón "Dar de baja" hace lo mismo.
- Cada empleado puede tener su **horario propio** (si no, rige el del
  negocio) y conectar su **Google Calendar personal** para que sus eventos
  privados bloqueen su agenda ("Conectar" abre Google acá mismo; "Copiar
  link" da un enlace de 10 minutos para que la persona autorice desde su
  propia cuenta).
- La ficha guarda los datos administrativos (cédula, cargo, fechas, IPS,
  salario, contacto de emergencia). Qué campos son obligatorios lo define
  el negocio con el botón "Campos obligatorios"; si faltan aparece "Faltan
  campos obligatorios de la planilla de tu empresa".
- La columna "Acceso al panel" dice si esa persona ya tiene cuenta para
  entrar al sistema (se cruza por email). "Crear acceso" abre la otra
  pestaña con nombre y email ya cargados.

**Pestaña Accesos al panel** (`?vista=accesos`; la URL vieja /app/team
redirige acá): las cuentas con las que la gente entra al panel.

- Alta con contraseña temporal mostrada UNA sola vez, en una línea lista para
  pegar ("Usuario: ana@… | Contraseña: AsQ123") con botón Copiar. Si el
  navegador no permite copiar (pasa entrando por http en la red local), el
  texto queda seleccionado y avisa que se copie con Ctrl+C.
- Roles: Personal (staff: agenda, chat, clientes, facturación) y
  Administrador (además catálogo, personal y ajustes). El dueño es root.
- "Nueva contraseña" genera una temporal nueva (también una sola vez) y
  cierra las sesiones de ese usuario.
- El usuario root no se elimina ni puede ser tocado por un admin.
- Acceso por sucursal: a una cuenta se le puede limitar qué sucursales ve.

**Campos de dinero (2026-09-07):** todos los campos de monto (precio del
catálogo, líneas de factura y presupuesto, monto recibido, salario, consumo)
muestran los puntos de miles mientras se escribe (150000 → 150.000).

### 3.10 Ajustes (ruta /app/settings/…)

Desde el 2026-09-05 Ajustes está dividido en secciones con un menú lateral;
la URL /app/settings sola redirige a la primera sección que corresponda al
rol. Secciones y quién las ve:

| Sección | Ruta | Quién |
|---|---|---|
| Empresa (datos y marca) | /app/settings/empresa | root, admin |
| Horarios de atención | /app/settings/horarios | root, admin |
| Bot de atención | /app/settings/bot | root, admin |
| WhatsApp | /app/settings/whatsapp | solo root |
| Google Calendar | /app/settings/calendario | solo root |
| Facturación electrónica | /app/settings/facturacion | solo root |
| Campos personalizados | /app/settings/campos | root, admin |
| Mi cuenta (contraseña) | /app/settings/cuenta | todos |

Los horarios de atención antes se editaban desde la Agenda; ahora la Agenda
tiene un botón que lleva a esta sección.

**Cómo se guarda (regla única desde el 2026-09-07):** todo formulario con
campos de texto tiene su botón **Guardar** y al guardar aparece un aviso
flotante abajo a la derecha ("… guardados" en verde, o el error en rojo).
Los **interruptores** (Encendido del bot, cada permiso del bot, Activados de
los recordatorios, "obligatorio" de un campo propio) se aplican al instante
y también muestran el aviso flotante "Cambio guardado" o el error. Si el
aviso no aparece, el cambio NO se guardó. En Bot, los campos de texto
(videollamada, indicaciones, plantilla del recordatorio) van con el botón
Guardar de su bloque; mientras haya cambios sin guardar el bloque avisa
"Hay cambios sin guardar". Al re-guardar WhatsApp no hace
falta retipear el token de acceso ni el verify token: si se dejan vacíos se
conservan los ya cargados.

- **Datos de la empresa y marca**: razón social, fantasía, RUC (el dígito
  verificador se completa solo), dirección, teléfono, actividad, email de
  facturación y logo (PNG/JPEG máx ~350 KB). Todo esto sale en el KuDE y lo
  usa el bot para responder.
- **Bot de atención y agendamiento**: interruptor general "Encendido" y los
  permisos, que son literales — un permiso destildado hace que esa capacidad
  NO exista para el bot:
  - Puede consultar el catálogo y precios.
  - Puede consultar disponibilidad de agenda.
  - Puede agendar turnos (incluye cancelar y reprogramar por chat).
  - Turnos del bot se confirman solos (sin confirmación manual del negocio).
  - Puede ver historial del cliente de la conversación.
  - Puede ver datos del cliente y agendarlo si se presenta en el chat.
  - Resumen automático al quedar inactiva una conversación (consume IA).
  - **Link de reuniones virtuales** (Meet/Zoom): con link cargado el bot
    ofrece videollamada y entrega el link al confirmar; sin link, el bot
    aclara que la atención es presencial y JAMÁS promete videollamadas.
  - **Instrucciones del negocio**: texto libre con la personalidad y reglas
    comerciales del negocio (tono, promociones vigentes, políticas). No hace
    falta escribir precios ni horarios: el bot los consulta en vivo. La
    casilla "Priorizar mis instrucciones" hace que, ante contradicción con la
    guía estándar, ganen las del negocio (las reglas de seguridad del sistema
    rigen siempre igual).
  - Abajo se ve el **uso de IA del mes** (% del límite). Si dice "Límite del
    mes agotado", el bot deriva todo a humanos hasta el mes siguiente; el
    límite lo sube el administrador de la plataforma desde la ficha del
    cliente.
- **Recordatorios de turnos por WhatsApp**: el sistema le escribe solo al
  cliente antes de su turno (cuánto antes, configurable). Con WhatsApp real
  hace falta elegir la plantilla aprobada de Meta y su idioma.
- **WhatsApp**: el identificador del negocio (phone_number_id), el token de
  acceso y el verify token. En pruebas puede ser cualquier identificador
  (ej. dev-mi-negocio) y se prueba desde el chat de prueba; con la cuenta
  real de Meta se cargan los datos reales y el mismo circuito queda
  productivo. Solo el usuario root ve esta sección.
- **Google Calendar del negocio**: conecta el calendario del negocio; cada
  turno aparece como evento, las cancelaciones lo quitan, y los eventos
  cargados a mano en Google bloquean esos horarios.
- **SIFEN**: timbrado (8 dígitos), establecimiento, punto de expedición e
  inicio de vigencia. Sin esto no se emiten facturas.
- **Campos personalizados**: definición de los campos propios de la ficha de
  clientes.
- **Mi contraseña**: cualquier usuario cambia la suya (pide la actual, mínimo
  8 caracteres la nueva, y cierra las demás sesiones abiertas).

---

## 4. El bot de WhatsApp a fondo

- Atiende como una persona más del equipo del negocio: responde precios y
  horarios consultando el sistema en vivo (jamás inventa), agenda, cancela y
  reprograma turnos, registra datos del cliente y deriva a humanos cuando
  hace falta.
- **El registro del cliente es 100% opcional**: el sistema identifica por
  teléfono; el bot pide el nombre UNA vez con amabilidad y si no se lo dan,
  atiende exactamente igual.
- Espera unos segundos antes de responder (por defecto 15) por si el cliente
  manda varios mensajes seguidos: responde una sola vez.
- Todo lo que el bot hace queda registrado y trazable; sus mensajes se ven en
  la bandeja en color distinto a los del personal.
- El horario que ofrece sale de la disponibilidad real (horario de atención +
  turnos existentes + Google Calendar). Si un día está cerrado, no lo ofrece.
- Cuando el bot no puede resolver algo o el cliente pide una persona, marca
  la conversación con "Necesita humano" y avisa al cliente que alguien del
  equipo sigue el chat.

### Por qué el bot puede dejar de responder con IA

En orden de frecuencia:
1. **El proveedor de IA rechaza las consultas** (sin crédito, llave inválida
   o vencida): TODOS los bots mandan solo el aviso de respaldo ("Gracias por
   tu mensaje! En breve una persona del equipo te responde…"). Se arregla en
   el portal admin → Motor del bot (crédito/llave). Esto afecta a todos los
   clientes a la vez: si varios reportan lo mismo, es esto.
2. **El cliente agotó su límite mensual de IA**: solo ese negocio; el aviso
   que manda es el de "límite agotado". Se sube el límite desde su ficha.
3. **El bot está apagado o el motor sin configurar**: en Ajustes del negocio
   el bot figura "apagado"; si dice "El motor de IA aún no está configurado
   por el administrador del sistema", falta la llave en el portal admin.
4. **La conversación está pausada o con agente**: el bot no responde esa
   conversación puntual hasta reactivarlo.

---

## 5. Errores del sistema — significado y solución

### Errores generales (pueden aparecer en cualquier pantalla)

| Mensaje | Qué significa | Qué hacer |
|---|---|---|
| Datos invalidos | Algún campo del formulario no cumple el formato (email mal escrito, texto muy largo, número donde va texto…) | El detalle indica el campo exacto; corregirlo y reintentar |
| No existe | El registro no existe **o pertenece a otro negocio** (por seguridad se responde igual en ambos casos) | Verificar que se está en el negocio correcto y que el registro no fue eliminado |
| Ya existe un registro con esos datos | Se intenta crear algo duplicado (mismo email, código, teléfono…) | Buscar el registro existente y usarlo/editarlo |
| Error interno | Falla no prevista del sistema; incluye un `trace_id` | Anotar el trace_id, la hora y qué se estaba haciendo, y escalar al dueño de la plataforma |
| Demasiados intentos, proba de nuevo en unos minutos | Límite de velocidad: demasiadas operaciones seguidas | Esperar un minuto y reintentar |
| Bloqueado temporalmente por intentos fallidos; proba mas tarde | Varias contraseñas incorrectas seguidas (10 en 10 min por defecto) | Esperar ~10 minutos; verificar la contraseña; si la olvidó, reiniciarla |
| La cuenta de la empresa esta suspendida | El negocio está suspendido en la plataforma (p. ej. falta de pago) | Solo el administrador de la plataforma reactiva desde la ficha del cliente |
| No se pudo conectar con la API | El navegador no llega al servidor | Ver sección 6.1 |

### Por módulo

**Login y cuenta**
- "Se requiere codigo TOTP": la cuenta tiene doble factor activado; falta el
  código del autenticador.
- "La contrasena actual no coincide": al cambiar la propia contraseña, la
  actual está mal escrita.
- La contraseña nueva necesita mínimo 8 caracteres.

**Clientes (CRM)**
- "Ya existe un cliente con ese telefono, email o documento": duplicado; el
  aviso trae el enlace a la ficha existente.
- "El cliente tiene facturas: desactivar, no borrar": historial fiscal; se
  desactiva.
- "No se puede unir consigo mismo": en fusión de duplicados se eligió dos
  veces la misma ficha.

**Catálogo**
- "Categoria inexistente": la categoría fue eliminada o es de otro negocio.
- "La categoria tiene servicios activos": desactivar o mover los productos
  antes de eliminarla.
- "Imagen invalida": el archivo no es PNG/JPEG o está corrupto.
- "Crea primero tus categorias en el catalogo: la plantilla se arma con
  ellas": intentó descargar la plantilla CSV sin categorías creadas.
- "El archivo esta vacio: completa la plantilla y volvela a subir": el CSV no
  tiene filas de datos.

**Agenda**
- "Sin empleados libres en ese horario" / "El empleado elegido ya tiene un
  turno en ese horario": ocupado a esa hora.
- "Ningun empleado agendable trabaja en ese horario" / "El empleado elegido
  no trabaja en ese horario": fuera del horario de atención o del empleado.
- "Para agendar hace falta al menos un empleado que atienda clientes con
  turno": cargar un empleado agendable en Personal.
- "El empleado elegido esta ausente ese dia": tiene una ausencia cargada;
  elegir otra persona o quitar la ausencia en Personal.
- "<Empleado> tiene N turnos en ese período": no es un error; es el aviso al
  registrar una ausencia o dar de baja: elegir avisar a los clientes o
  registrar sin avisar.
- "El empleado elegido no existe o no es agendable": revisar en Personal que
  esté activo y con "Atiende clientes con turno" tildado.
- "Solo se confirman turnos pendientes" / "El turno no se puede cancelar" /
  "El turno no se puede completar": el turno ya está en un estado final.
- "La sucursal tiene turnos futuros": no se elimina una sucursal con agenda
  viva; reprogramar o cancelar esos turnos antes.
- "La sucursal principal no se elimina".

**Facturación y presupuestos**
- "Configura los datos de SIFEN (timbrado, establecimiento, punto) antes de
  emitir": completar Ajustes → SIFEN.
- "Solo se emiten borradores" / "Solo se borran borradores" / "Solo los
  borradores se editan; crea uno nuevo".
- "Solo se anulan facturas aprobadas" y "Fuera del plazo de 48 h: corresponde
  nota de credito" (las notas de crédito aún no están: escalar).
- "Solo se registran pagos sobre facturas aprobadas" y "El pago excede el
  saldo pendiente".
- "El KuDE existe solo para facturas emitidas (aprobadas por SIFEN)" y
  "Registra el pago antes de generar el KuDE".
- "Un presupuesto rechazado no se factura" / "Este presupuesto ya se
  facturo" / "Un presupuesto X no puede pasar a Y" (respetar el flujo
  borrador → enviado → aceptado/rechazado).

**Personal (fichas y accesos)**
- "Faltan campos obligatorios de la planilla de tu empresa": la planilla
  define campos obligatorios que quedaron vacíos.
- "El empleado no existe": fue archivado o eliminado.
- "El usuario root no se elimina" / "Tu propio usuario se edita desde Mi
  perfil".
- "Ese email ya lo usa otro operador" / "Ya existe un operador con ese
  email".

**Integraciones**
- "La plataforma aun no tiene configurada la app de Google (avisale al
  administrador del sistema)": falta el Client ID/secreto de Google en el
  portal admin.

**Planes (portal admin)**
- "Plan inexistente" / "Feature inexistente" / "Alguna feature no existe":
  el código de plan o función escrito no existe; revisar la lista.

---

## 6. Problemas frecuentes — diagnóstico paso a paso

### 6.1 "No se pudo conectar con la API"

El navegador no llega al servidor. Revisar en orden:
1. ¿Escribió bien la dirección, con https? Probar entrando de nuevo a
   https://client.inicia.com.py (o admin.).
2. ¿Tiene internet? ¿Otros sitios cargan?
3. ¿Está en una red de empresa con firewall/proxy? Probar con los datos del
   celular: si así funciona, es la red de su oficina (ver 6.2).
4. Si a NADIE le funciona, el sistema puede estar caído: escalar al dueño de
   la plataforma de inmediato.

### 6.2 Chrome dice "ERR_CERT_AUTHORITY_INVALID" o menciona "Fortinet"

No es un problema del sistema: la red o la PC del usuario tiene un firewall
corporativo (Fortinet u otro) que intercepta las conexiones seguras, y a esa
PC le falta el certificado del propio firewall.
- Confirmación rápida: entrar desde el celular con datos móviles; si funciona,
  es la red de la oficina.
- Solución de fondo: el encargado de sistemas de ESA empresa debe instalar el
  certificado raíz de su firewall en la PC, o excluir `*.inicia.com.py` de la
  inspección SSL.
- NUNCA indicar "saltear la advertencia" ni entrar por http.

### 6.3 El bot responde siempre "Gracias por tu mensaje! En breve una persona del equipo te responde…"

Ese es el aviso de respaldo: la IA está fallando. Ver sección 4 ("Por qué el
bot puede dejar de responder"): crédito/llave del proveedor (afecta a todos),
límite mensual del cliente (afecta a uno), bot apagado, o conversación
pausada.

### 6.4 El cliente no ve el módulo X en su panel

Su plan (o un acuerdo a medida) tiene esa función apagada. Se revisa en el
portal admin → ficha del cliente → funciones.

### 6.5 El bot no ofrece horarios / ofrece "no hay disponibilidad"

1. ¿El negocio cargó su horario de atención (Agenda → Horarios)? Un día sin
   franjas está cerrado.
2. ¿Hay al menos un empleado con "Atiende clientes con turno" tildado?
3. ¿Los servicios tienen duración cargada?
4. ¿Un evento del Google Calendar conectado está bloqueando esos horarios?

### 6.6 No puede entrar al panel

1. ¿Portal correcto? Los negocios entran por client.inicia.com.py; los
   operadores por admin.inicia.com.py. Las cuentas NO son intercambiables.
2. ¿Mensaje "Bloqueado temporalmente"? Esperar ~10 minutos.
3. ¿"La cuenta de la empresa esta suspendida"? Resolver la suspensión en la
   plataforma.
4. ¿Olvidó la contraseña? Un admin de su negocio (o nosotros desde la ficha
   del cliente) la reinicia; la temporal se muestra una sola vez.

### 6.7 Las fechas se ven "al revés" (mes/día)

Las fechas se muestran en el formato regional de la computadora de quien
mira. Si el usuario las ve en formato americano, su sistema operativo está
configurado en inglés/EE.UU.; puede cambiarlo en la configuración regional de
su PC. No es un error del sistema.

### 6.8 No puede subir el logo o una foto

Máximo ~350 KB, solo PNG o JPEG. Achicar la imagen (p. ej. con Paint o un
compresor online) y volver a subir.

### 6.9 El CSV de catálogo es rechazado

La vista previa marca los errores fila por fila. Causas típicas: categoría
inexistente (crearla primero y volver a descargar la plantilla), precio con
puntos o símbolos (va el número solo), tipo distinto de "servicio"/"item",
más de 500 filas (partir el archivo). No se importa nada hasta que todo esté
bien: es a propósito, para no dejar el catálogo a medias.

### 6.10 El cliente quiere probar el bot sin tener WhatsApp conectado

Bandeja de chat → panel de prueba → "Abrir chat de prueba". Se escribe como
si fuera un cliente final y la conversación aparece en la bandeja. El
identificador que usa el chat es el de Ajustes → WhatsApp.

---

## 7. Reglas de oro del soporte

1. **Jamás pedir ni anotar contraseñas de clientes.** Para recuperar acceso
   se usa "Reiniciar contraseña", nunca "decime tu clave".
2. Las contraseñas temporales se muestran UNA sola vez: copiarlas en el
   momento y pasarlas por un canal seguro.
3. Los datos de cada negocio son privados: nunca comentar información de un
   cliente con otro, ni mirar datos que no hagan falta para el caso.
4. Ante "Error interno": anotar el `trace_id`, la hora exacta y los pasos que
   lo provocaron, y escalar. Sin trace_id es mucho más difícil investigar.
5. Cambios de planes, precios, límites de IA y suspensiones: solo con
   autorización del dueño de la plataforma.
6. Si un problema afecta a VARIOS clientes a la vez (nadie puede entrar,
   ningún bot responde), escalar de inmediato: es un incidente de plataforma,
   no un caso de soporte.
7. Nunca prometer al cliente funciones que el sistema no tiene hoy (notas de
   crédito, pagos online, otros canales de chat): registrar el pedido y
   escalarlo como sugerencia.
