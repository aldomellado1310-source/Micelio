// veritest/functions/index.js
//
// Dos funciones, nada más:
//   verify           (HTTP, público)  GET /api/verify?id=... | ?hash=...
//   registerDiploma  (callable, emisor autenticado)  recibe un PDF ya hecho,
//                    lo registra, le pega el QR de Veritest y lo devuelve.
//
// Todo el acceso a Firestore es por Admin SDK desde acá (firestore.rules niega
// el acceso de cliente). Despliegue: lo hace Aldo; ver veritest/README.md.
'use strict';
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createFirestoreStore } = require('./lib/stores.js');
const { handleVerify, handleRegister } = require('./lib/handlers.js');
const { resolveIssuer } = require('./lib/issuer.js');
const { resolveBaseUrl } = require('./lib/urls.js');
const { VeritestError } = require('./lib/errors.js');

initializeApp();

const REGION = 'southamerica-east1';

function store() {
  return createFirestoreStore(getFirestore());
}

// code de VeritestError -> code de HttpsError del callable.
const HTTPS_CODE = {
  unauthenticated: 'unauthenticated',
  permission_denied: 'permission-denied',
  already_registered: 'already-exists',
  id_collision: 'aborted',
  invalid_pdf: 'invalid-argument',
  encrypted_pdf: 'invalid-argument',
  rotated_page: 'invalid-argument',
  pdf_too_large: 'invalid-argument',
  invalid_meta: 'invalid-argument',
  invalid_stamp_options: 'invalid-argument',
  stamp_out_of_bounds: 'invalid-argument',
  invalid_base_url: 'failed-precondition',
};

exports.verify = onRequest(
  { region: REGION, maxInstances: 10 },
  async (req, res) => {
    // Cada id/huella es única y la respuesta puede cambiar (revocación en el
    // futuro): nunca cachear en CDN ni navegador.
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }
    try {
      const r = await handleVerify(req.query, store());
      res.status(r.status).json(r.body);
    } catch (err) {
      logger.error('verify falló', err);
      // Falla CERRADA: error explícito, nunca un "válido" por omisión.
      res.status(500).json({ error: 'internal' });
    }
  }
);

exports.registerDiploma = onCall(
  { region: REGION, memory: '512MiB', timeoutSeconds: 60, maxInstances: 5 },
  async (request) => {
    const db = getFirestore();
    try {
      const issuer = await resolveIssuer(request.auth, db);
      return await handleRegister({
        data: request.data,
        issuer,
        actorUid: issuer.uid,
        store: createFirestoreStore(db),
        baseUrl: resolveBaseUrl(process.env.VERITEST_BASE_URL),
      });
    } catch (err) {
      if (err instanceof VeritestError) {
        throw new HttpsError(HTTPS_CODE[err.code] || 'internal', err.message, { code: err.code, ...(err.details || {}) });
      }
      logger.error('registerDiploma falló', err);
      throw new HttpsError('internal', 'No se pudo registrar el diploma.');
    }
  }
);
