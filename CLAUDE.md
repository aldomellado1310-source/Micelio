# Contexto P0 — SW Studio

Sistema de agendamiento sobre Firebase (Hosting, Firestore, Functions Node 22
en southamerica-east1, Auth, Storage). Producción: scissorwhite.cl.
Resend para correo, Google Places para reseñas.

Proyectos GCP separados a propósito (ver README.md#Contexto:-Micelio):
`scissor-white` (este repo, producción de Scissor White, `.firebaserc` default)
y `registrago001` (base de la futura plataforma Micelio, cuenta de facturación
aparte). El trabajo de Etapa T/A del pool ReservaGo (tenants/, subcolecciones
por tenant, etc.) apunta conceptualmente a `registrago001` -- no interfiere
con la producción de Scissor White aunque viva en el mismo repo/firestore.rules,
porque son bases de datos completamente distintas. No mezclar ambos proyectos
en un deploy hasta que exista una decisión explícita de migrar Scissor White
(ese es el goal de cierre 17).

public/index.html        landing + widget de reservas, ~4.000 líneas, JS y CSS inline
public/admin/index.html  panel admin, ~3.700 líneas, JS y CSS inline
public/js/data.js        única capa que habla con Firestore, Storage y Functions
functions/               callables y triggers
firestore.rules, storage.rules

Estado conocido, a verificar antes de tocar nada:
- Solape y zona horaria: la fuente única es functions/shared/availability.js y
  functions/shared/timezone.js. Ambos HTML lo consumen vía un bundle esbuild
  (functions/shared/index.js -> public/js/core.bundle.js, IIFE global
  `SWCore`, comando `npm run build:core`) en vez de copias inline: sus
  funciones antes duplicadas (toMin/DEFAULT_TZ/dateKeyInZone/timeKeyInZone en
  el widget; DEFAULT_TZ/checkConflict()/checkScheduleBlock() en el admin) son
  ahora alias o llamadas directas a SWCore. checkConflict()/checkScheduleBlock()
  del admin YA NO arman objetos Date en hora del navegador -- usan minutos-
  desde-medianoche vía SWCore.toMinutes/SWCore.overlaps, igual que el
  servidor. Cubierto por functions/test/crosscheck.solape.test.js (goal 3):
  corre el TEXTO ACTUAL de isBarberFreeAt()/checkConflict() de ambos HTML
  contra functions/shared/availability.js#isRangeFree para el mismo set de
  casos -- revienta si cualquiera de los tres diverge (probado a propósito
  con un bug deliberado, revertido antes de commitear). SIGUE PENDIENTE una
  verificación real en navegador/emulador (no había firebase-tools instalado
  en el entorno donde se hizo este cambio) antes de confiar en esto en
  staging -- el cross-check en Node no reemplaza esa prueba, solo da
  regresión automática. hoursRangeFor()/dowOfDateKey()/dateKeyToDate()/
  parseDt()/parseYmd() siguen locales a propósito -- no son duplicados de
  shared/, resuelven un problema distinto (presentación o forma de retorno).
  Cambiar una regla en shared/ requiere correr `npm run build:core` para que
  se refleje en el bundle -- el CI (goal 4, ver más abajo) NO verifica que el
  bundle esté al día, solo que functions/index.js y functions/deploy-list.json
  coincidan; ese riesgo de "paso manual olvidado" para el bundle sigue sin
  cubrir.
  Validación: functions/shared/validate.js es la única implementación real
  (isValidBookingPayload). firestore.rules mantiene isValidBooking() como copia
  CEL muerta (documentación) y isValidEmail() como el único gate real del camino
  de escritura directa del admin — esa brecha sigue sin cerrar.
  Estado: functions/shared/status.js centraliza DEFAULT_BOOKING_STATUS
  ('pending'), pero sigue sin existir ninguna transición de estado en el repo.
- isAdmin() es custom claim admin:true O UN UID ESCRITO A MANO, repetido en cuatro
  archivos: firestore.rules, storage.rules (x2), functions/index.js.
- buildBookingDoc() escribe status:'pending' fijo y nada lo cambia jamás.
- deleteBooking() hace deleteDoc: cancelar destruye el registro.
- log() escribe en memoria; saveAdmin() solo persiste services, staff y businessInfo.
  adminLog nunca se escribe desde el panel.
- computeAvailability no filtra por status.
- Tenencia (Etapa T, goal 5 del pool ReservaGo -- arranca, no está completa):
  existen `tenants/{tenantId}` (PII: name, slug, domain, status, plan,
  contactEmail, contactName, timezone, createdAt, createdBy) y
  `tenantsByDomain/{dominio}` -> {tenantId, slug} (público, sin PII).
  `functions/tenant.js#resolveTenantId(request, db)` es el helper que TODO
  callable de negocio debe usar para obtener el tenantId real -- nunca leerlo
  de `request.data`. Decisión clave: los callables se invocaban directo
  contra `*.cloudfunctions.net` (sin pasar por Hosting), así que
  `request.rawRequest.hostname` SIEMPRE era el dominio de Cloud Functions,
  nunca `scissorwhite.cl` -- se resolvió agregando un rewrite de Firebase
  Hosting (`firebase.json#hosting.rewrites`, `/api/<función>` ->
  `functionId`+`region`) para las funciones que necesiten ver el dominio
  real; Hosting hace de proxy y preserva el Host original. Probado de punta a
  punta con el emulador real (Hosting+Functions+Firestore, no solo un
  test unitario): `exports.resolveTenant` en `functions/index.js` es el único
  callable expuesto así por ahora -- prueba de concepto, TODAVÍA no conectado
  a resources/services/bookings (eso son los goals siguientes). Los
  callables existentes (createBooking, getAvailability, etc.) siguen
  invocándose igual que siempre, sin rewrite, sin tocar. `tenants/{tenantId}`
  es legible/escribible solo por `isSuperadmin()` desde el goal 7 (antes,
  `if false` -- ni siquiera isAdmin()). No hay datos reales todavía (no se
  migró nada de Scissor White, eso es el goal de cierre 17).
  Goal 6: `tenants/{tenantId}/{resources,services,bookings,holds,auditLog,
  dataRequests}/...` tienen regla de aislamiento genérica en firestore.rules
  (`match /tenants/{tenantId}/{collection}/{docId}`, exige
  `request.auth.token.tenantId == tenantId` y el nombre de colección en la
  lista permitida) -- probada con claims sintéticos vía authenticatedContext()
  en tests/rules/tenant-isolation.rules.test.js (31 tests: cada una de las
  seis colecciones, tenant propio permitido, tenant ajeno denegado, anónimo
  denegado, isAdmin() sin tenantId denegado). request.auth.token.tenantId es
  la forma de claim que el goal 14 recién va a EMITIR (setUserRole) -- la
  regla ya la exige desde ahora, sin esperar a que ese callable exista. A
  propósito SIN roles finos (owner/reception/staff+resourceId, goal 14) ni
  excepción de superadmin (goal 7/8) -- solo aislamiento tenant-vs-tenant.
  Las colecciones de nivel raíz (services/staff/bookings) NO se tocaron --
  siguen siendo las que usa Scissor White hoy; el corte real a esta ruta es
  el goal 17, no este.
  Goal 7: `platformRole:'superadmin'` es un nivel de rol SEPARADO del role de
  negocio de un tenant (owner/reception/staff+tenantId, goal 14) -- nunca se
  mezclan en el mismo claim ni en la misma función de reglas
  (`isSuperadmin()` en firestore.rules, independiente de `isAdmin()` y del
  chequeo de `tenantId` del goal 6). `functions/platformRole.js#setPlatformRole`
  es la única forma de otorgar el rol vía código, y exige que quien lo invoque
  YA sea superadmin -- ningún callable puede auto-otorgárselo. Hace MERGE de
  claims (nunca overwrite) al escribir, a diferencia de
  `functions/scripts/setAdminClaim.js` (que sobreescribe sin mirar, pero
  vive en el proyecto scissor-white donde hoy no hay nada más que perder).
  El primer superadmin se asigna a mano con
  `functions/scripts/setPlatformRole.js` contra el proyecto `registrago001`
  (ver README.md#Primer-superadmin-de-la-plataforma) -- no por consola de
  Firebase en sentido literal (esa UI no expone custom claims), sino corrido
  fuera de la app con credenciales reales, mismo patrón que setAdminClaim.js.
  Probado que un superadmin puro NO puede leer/escribir ni las colecciones de
  nivel raíz de Scissor White ni ninguna subcolección de tenant (goal 6) --
  tests/rules/platform-role.rules.test.js, 5 tests contra el emulador real.
  Goal 8: existe `public/superadmin/index.html` -- panel de PLATAFORMA
  separado de `public/admin/index.html` (panel de negocio), solo accesible
  con `isSuperadmin()`. Opera contra `registrago001` vía
  `public/js/firebase-init-platform.js` -- CONFIG PENDIENTE: son placeholders,
  no hay ninguna app web real registrada en `registrago001` todavía, hay que
  reemplazarlos (ver el comentario de cabecera de ese archivo) antes de que
  el panel funcione de verdad. `public/js/platform-auth.js`/`platform-data.js`
  son los equivalentes de auth.js/data.js para este panel -- mismo patrón,
  nunca comparten Firebase app con el panel de negocio. Alta/suspensión/
  reactivación son escrituras DIRECTAS a `tenants/{tenantId}` (mismo criterio
  que el admin panel usa para services/staff, sin callable) protegidas por
  `stamped()` en firestore.rules (exige `updatedBy == request.auth.uid` y
  `updatedAt == request.time` en cada create/update) -- sin esto,
  `platformAuditLog` no podría atribuir un cambio al superadmin real que lo
  hizo, porque Firestore no le entrega esa identidad a un trigger de ninguna
  otra forma. Mismo problema que el goal 15 va a resolver para auditLog de
  negocio, adelantado acá porque platformAuditLog lo necesita ya. Un tenant
  NUNCA se borra -- ni un superadmin puede (`allow delete: if false`, más
  estricto que services/staff, donde eso es solo convención sin gate en la
  regla). Suspender bloquea la ESCRITURA de las subcolecciones del tenant
  (goal 6) de inmediato vía `isTenantSuspended()` (un `get()` a
  `tenants/{tenantId}` desde la regla) pero NO la lectura -- "no borra ni
  oculta sus datos" es literal. Decisión de producto pedida por el goal (widget
  público de un tenant suspendido): apagarlo por completo perdería el invariante "nada se
  oculta"; la forma más simple es que, cuando el widget público se vuelva
  tenant-aware (goal 9+), `tenantsByDomain/{dominio}` (ya público, sin PII)
  refleje también `status` -- mantenido por el mismo trigger onTenantWritten
  el día que haya un dominio real que sincronizar (hoy ningún tenant tiene
  domain asignado, así que no hay nada que sincronizar todavía) -- y el
  widget, si ve `status:'suspended'`, muestra un aviso estático en vez del
  flujo de reserva, sin dejar de mostrar el resto del sitio. No implementado
  todavía -- es una decisión de diseño registrada, el widget público sigue
  sin ser tenant-aware.
  `functions/index.js#onTenantWritten` (trigger) + `functions/platformAuditLog.js`
  (lógica pura) mantienen `platformAuditLog/{id}` -- solo lectura para
  superadmin, escritura solo Admin SDK. Verificación completa: sin acceso a
  gstatic.com en este entorno (403 del proxy de egress, confirmado, no es
  un bug a rodear) no se pudo cargar el panel en un navegador real contra
  Firebase de verdad -- se verificó la lógica de UI completa (login,
  credenciales inválidas, alta/suspensión/reactivación/logout, y el camino
  de acceso denegado) con jsdom mockeando PlatformAuth/PlatformData, y el
  aislamiento de datos con el emulador real de reglas
  (tests/rules/tenant-lifecycle.rules.test.js, 9 tests). Sigue pendiente una
  prueba real en navegador contra Firebase, igual que goals 2/3.
  Etapa A -- modelo de datos de negocio dentro de un tenant (arranca en el goal 9,
  ya sobre el esquema con tenantId del goal 6; no hay una versión sin tenant que
  migrar después):
  Goal 9: `functions/shared/resource.js` define el modelo de `resource`
  (reemplaza "el recurso es el barbero" -- puede ser `kind:'person'`,
  `'space'` o `'equipment'`), agnóstico de tenant igual que el resto de
  `shared/`. `schedule[0..6]` reusa DELIBERADAMENTE el mismo shape que ya
  usa `staff.schedule` en Scissor White hoy (`{open,start,end,break:{start,end}}`,
  ver `computeAvailability` en `functions/shared/availability.js`) -- no se
  inventa un formato nuevo, para que la migración staff -> resources del
  goal 17 no tenga que transformar este campo. `profile{photo,bio}` es
  EXCLUSIVO de `kind:'person'` -- `isValidResourcePayload()` rechaza un
  `space`/`equipment` que traiga `profile`. Vive únicamente en
  `tenants/{tenantId}/resources/{id}` (subcolección del goal 6, que ya
  cubre el aislamiento tenant-vs-tenant estructuralmente) -- no existe ni
  debe crearse una colección `resources` de nivel raíz;
  `tests/rules/resource.rules.test.js` prueba contra el emulador tanto la
  forma real del documento (person con profile, space sin profile) como que
  una ruta `/resources/{id}` sin tenantId cae por deny-all implícito, no
  por convención. Todavía SIN callable de escritura (create/update de un
  resource sigue siendo, por ahora, fuera de alcance de este goal) ni
  wiring en ningún panel HTML -- goal 9 solo entrega el modelo de datos y
  su validación; conectarlo a un panel de negocio multi-tenant real es
  trabajo de goals posteriores (y del goal 17 para Scissor White en
  particular).
  Goal 10: `functions/shared/service.js` define `requires:
  [{kind,anyOf,count}]` de un servicio -- una cita puede necesitar varios
  recursos a la vez (una persona Y un box). `normalizeServiceRequires()` es
  la ÚNICA función que debe leer `service.requires`: un servicio sin
  requires (o con `requires` vacío) devuelve siempre `DEFAULT_REQUIRES`
  (`[{kind:'person', anyOf:null, count:1}]`) -- el REQUISITO DURO del goal,
  formalizado como dato en vez de dejarlo implícito en cómo agrupaba
  computeAvailability(). `functions/shared/availability.js` gana
  `computeResourceAvailability()`/`isServiceBookableAt()`, la generalización
  tenant-aware de `computeAvailability()`/`isRangeFree()` -- agrupa
  ocupación por `resourceIds[]` de la reserva (no por un único `barberId`) y
  exige que CADA requerimiento tenga suficientes recursos libres del kind
  correcto. Coexiste con `computeAvailability()`: Scissor White sigue usando
  staff/barberId hasta la migración del goal 17. `bookings.resourceIds[]`
  usado acá es el campo que el goal 11 recién va a agregar a los documentos
  reales -- este goal solo lo consume como forma de parámetro puro, no
  escribe ningún booking todavía. `functions/test/service.crosscheck.test.js`
  prueba el REQUISITO DURO contra una captura real de
  computeAvailability()/isRangeFree() para una jornada completa (múltiples
  barberos, reservas, colación y un bloqueo): el motor nuevo con el
  requires por defecto debe producir el mismo booleano "agendable" que el
  motor viejo en CADA slot de 15 minutos del día -- probado a propósito con
  un bug deliberado (ignorar bufferMin), revertido antes de commitear, igual
  criterio que crosscheck.solape.test.js del goal 3. Sin callable ni wiring
  en ningún panel todavía -- mismo alcance que el goal 9.
- Despliegue: `functions/deploy-list.json` es la lista versionada de funciones a
  desplegar (ya no ocho nombres a mano en README.md).
  `functions/scripts/printDeployTargets.js` arma el `--only` de
  `firebase deploy` a partir de ese JSON. CI (.github/workflows/ci.yml,
  goal 4) corre en cada push/PR: `functions/scripts/checkDeployList.js`
  (falla si `functions/index.js` exporta algo que no está en
  deploy-list.json -- el incidente real de createBooking, 2026-08-23), los
  tests de `functions/` (`node --test`, incluye el cross-check de goal 3), y
  los tests de reglas contra el emulador de Firestore+Storage
  (`npm run test:rules`). De paso se corrigió un bug real preexistente en ese
  script: solo levantaba el emulador de Firestore (`--only firestore`) y
  tests/rules/storage.rules.test.js fallaba siempre por falta del emulador de
  Storage -- ahora `--only firestore,storage`. El deploy sigue siendo manual
  (Aldo lo corre); el CI no despliega nada, solo verifica.

INVARIANTES — ningún goal puede romperlos:
- La zona horaria del negocio gobierna, nunca la del navegador (IANA, zonedInstant()).
- Precio, duración y recursos se resuelven en el servidor, jamás desde el payload.
- Dentro de transacciones solo tx.get(), nunca db.get() suelto.
- El widget falla abierto: si la disponibilidad no carga, muestra todo disponible.
- Nada del catálogo se borra; los servicios retirados pasan a inactive.
- availability/{fecha} nunca contiene PII.

PROHIBIDO en todas las etapas 0 y A:
- Migrar a React, Vue o cualquier framework.
- Reescribir los HTML monolíticos: sustituir funciones, no reestructurar.
- Implementar holds, recordatorios, autogestión o WhatsApp (eso es etapa B y C).
- Tocar el módulo de reseñas de Google.
- Cambiar el diseño visual.
- Desplegar a producción. Todo va a staging; los despliegues los hace Aldo.

REGLA DE TRABAJO: si el repo contradice algo de este contexto, detente y avísame
antes de escribir código. No improvises sobre una suposición equivocada.
