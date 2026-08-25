# Contexto P0 — SW Studio

Sistema de agendamiento sobre Firebase (Hosting, Firestore, Functions Node 22
en southamerica-east1, Auth, Storage). Producción: scissorwhite.cl.
Resend para correo, Google Places para reseñas.

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
