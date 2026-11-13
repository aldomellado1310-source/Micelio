// veritest/public/js/firebase-init-veritest.js
//
// Inicialización de Firebase del panel del emisor (public/issuer/).
//
// Solo Auth y Functions: este panel NUNCA habla con Firestore desde el
// navegador (firestore.rules niega todo acceso de cliente); registrar un
// diploma es el callable `registerDiploma`.
//
// ⚠️ CONFIG PENDIENTE: son PLACEHOLDERS -- todavía no existe el proyecto
// Firebase de Veritest. Antes de poder usar el panel hay que reemplazarlos:
// Firebase Console → proyecto de Veritest → Configuración del proyecto →
// General → "Tus apps" → app web → copiar el `firebaseConfig`. Igual que en el
// resto de los paneles del repo, esto NO es secreto (la seguridad la dan
// Auth y la validación del callable, no ocultar esta config).
const firebaseConfig = {
  apiKey: 'REEMPLAZAR-apiKey-del-proyecto-veritest',
  authDomain: 'REEMPLAZAR.firebaseapp.com',
  projectId: 'REEMPLAZAR-id-del-proyecto-veritest',
  appId: 'REEMPLAZAR',
};

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';

const app = initializeApp(firebaseConfig, 'veritest');
const auth = getAuth(app);
const functions = getFunctions(app, 'southamerica-east1');

if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  connectAuthEmulator(auth, 'http://localhost:9098', { disableWarnings: true });
  connectFunctionsEmulator(functions, 'localhost', 5002);
}

export { app, auth, functions };
