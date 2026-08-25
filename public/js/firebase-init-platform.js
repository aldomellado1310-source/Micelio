// public/js/firebase-init-platform.js
//
// Inicialización de Firebase para el panel de PLATAFORMA
// (public/superadmin/index.html) -- Etapa T, goal 8 del pool ReservaGo.
//
// A PROPÓSITO es un archivo separado de firebase-init.js: ese apunta al
// proyecto `scissor-white` (producción de Scissor White); este debe apuntar
// a `registrago001` (la plataforma Micelio -- ver
// README.md#Contexto:-Micelio, proyectos GCP separados a propósito, cuentas
// de facturación distintas). Mezclarlos en el mismo archivo/app de Firebase
// haría que el panel de plataforma opere contra la base de datos de
// producción de un cliente real -- exactamente el error que la separación
// de proyectos existe para evitar.
//
// ⚠️ CONFIG PENDIENTE: los valores de abajo son PLACEHOLDERS, no un proyecto
// real -- no hay ninguna app web registrada en `registrago001` en este repo
// todavía. Antes de poder usar este panel (ni siquiera contra el emulador
// con un projectId real) hay que reemplazarlos por los valores reales:
// Firebase Console → proyecto `registrago001` → Configuración del proyecto →
// General → "Tus apps" → agregar una app web si no existe → copiar el
// `firebaseConfig`. Igual que firebaseConfig en firebase-init.js, esto NO es
// secreto (la seguridad la dan las reglas/Auth, no ocultar esta config).
const firebaseConfig = {
  apiKey: 'REEMPLAZAR-con-la-apiKey-real-de-registrago001',
  authDomain: 'registrago001.firebaseapp.com',
  projectId: 'registrago001',
  storageBucket: 'registrago001.firebasestorage.app',
  messagingSenderId: 'REEMPLAZAR',
  appId: 'REEMPLAZAR',
};

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

// Nombre de app distinto ('platform') a propósito -- si alguna vez una
// página cargara sin querer tanto este archivo como firebase-init.js,
// initializeApp() con el mismo nombre por defecto ('[DEFAULT]') chocaría.
// No debería pasar (son paneles en rutas separadas, nunca la misma página),
// pero es una separación barata y explícita.
const app = initializeApp(firebaseConfig, 'platform');
const db = getFirestore(app);
const auth = getAuth(app);
// Sin getFunctions() todavía -- goal 8 no llama ningún callable desde este
// panel (crear/suspender/reactivar son escrituras directas a Firestore,
// mismo patrón que el admin panel usa para services/staff). Agregarlo
// recién cuando un goal futuro lo necesite de verdad.

if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}

export { app, db, auth };
