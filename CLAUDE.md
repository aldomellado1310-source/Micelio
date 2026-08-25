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
  no es legible ni escribible desde ningún claim hoy (ni siquiera isAdmin())
  -- solo Admin SDK, hasta que exista `platformRole:'superadmin'` (goal 7).
  No hay datos reales todavía (no se migró nada de Scissor White, eso es el
  goal de cierre 17).
  Goal 6: `tenants/{tenantId}/{resources,services,bookings,holds,auditLog,
  dataRequests}/...` tienen regla de aislamiento genérica en firestore.rules
  (`match /tenants/{tenantId}/{collection}/{docId}`, exige
  `request.auth.token.tenantId == tenantId` y el nombre de colección en la
  lista permitida) -- probada con claims sintéticos vía authenticatedContext()
  en tests/rules/tenant-isolation.rules.test.js (31 tests: cada una de las
  seis colecciones, tenant propio permitido, tenant ajeno denegado, anónimo
  denegado, isAdmin() sin tenantId denegado). request.auth.token.tenantId es
  la forma de claim que el goal 7 recién va a EMITIR (setUserRole) -- la
  regla ya la exige desde ahora, sin esperar a que ese callable exista. A
  propósito SIN roles finos (owner/reception/staff+resourceId, goal 14) ni
  excepción de superadmin (goal 7/8) -- solo aislamiento tenant-vs-tenant.
  Las colecciones de nivel raíz (services/staff/bookings) NO se tocaron --
  siguen siendo las que usa Scissor White hoy; el corte real a esta ruta es
  el goal 17, no este.
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
