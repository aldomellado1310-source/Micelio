// public/js/platform-data.js — capa de datos del panel de plataforma
// (public/superadmin/index.html, Etapa T goal 8). Expone window.PlatformData.
// Mismo patrón que public/js/data.js, pero contra `registrago001`
// (firebase-init-platform.js) -- NUNCA contra `scissor-white`.
import { db, auth } from './firebase-init-platform.js';
import {
  collection, getDocs, doc, setDoc, serverTimestamp, query, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// tenants/{tenantId} exige stamped() en firestore.rules (updatedBy ==
// request.auth.uid, updatedAt == request.time) para que el trigger
// onTenantWritten (functions/index.js) pueda atribuir cada fila de
// platformAuditLog al superadmin real que hizo el cambio -- Firestore no le
// entrega esa identidad al trigger de otra forma. Toda escritura de este
// archivo pasa por acá para no repetir el estampado en cada función.
function stamped(fields) {
  if (!auth.currentUser) throw new Error('No hay sesión activa.');
  return { ...fields, updatedBy: auth.currentUser.uid, updatedAt: serverTimestamp() };
}

async function loadTenants() {
  const snap = await getDocs(collection(db, 'tenants'));
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

// Crea un tenant nuevo con status:'active' -- ver la nota en
// public/superadmin/index.html sobre por qué no se ofrece 'trial' en el
// formulario de alta (goal 17 espera poder crear a Scissor White ya activo,
// sin un paso extra de "activar" después de crear). domain queda SIN
// asignar a propósito (goal 5: null mientras el cliente no tenga dominio
// propio) -- tenantsByDomain se arma aparte, cuando corresponda, fuera de
// este goal.
async function createTenant({ name, slug, timezone, contactEmail, contactName }) {
  const ref = doc(collection(db, 'tenants'));
  await setDoc(ref, stamped({
    name, slug, timezone, contactEmail, contactName: contactName || '',
    domain: null, status: 'active', plan: 'basic',
    createdAt: serverTimestamp(), createdBy: auth.currentUser.uid,
  }));
  return ref.id;
}

// Único mecanismo de suspender/reactivar -- nunca deleteDoc (firestore.rules
// ya lo prohíbe de todos modos: allow delete: if false). status es el ÚNICO
// campo que cambia; el resto del documento (contacto, plan, dominio) se
// preserva íntegro, tal como pide el goal ("no borra ni oculta sus datos").
async function setTenantStatus(tenantId, status) {
  await setDoc(doc(db, 'tenants', tenantId), stamped({ status }), { merge: true });
}

// Últimas 50 filas de auditoría de plataforma (altas, suspensiones,
// reactivaciones), más recientes primero. Escritas SOLO por el trigger
// onTenantWritten (Admin SDK) -- este archivo nunca escribe en
// platformAuditLog directamente, ver firestore.rules (allow write: if false).
async function loadPlatformAuditLog() {
  const q = query(collection(db, 'platformAuditLog'), orderBy('ts', 'desc'), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

window.PlatformData = { loadTenants, createTenant, setTenantStatus, loadPlatformAuditLog };
export { loadTenants, createTenant, setTenantStatus, loadPlatformAuditLog };
