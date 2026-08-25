// public/js/platform-auth.js — login del panel de plataforma
// (public/superadmin/index.html). Expone window.PlatformAuth. Mismo patrón
// que public/js/auth.js, pero contra el proyecto `registrago001`
// (firebase-init-platform.js) en vez de `scissor-white`.
import { auth } from './firebase-init-platform.js';
import {
  signInWithEmailAndPassword, signOut as fbSignOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}
async function signOut() { await fbSignOut(auth); }
function onChange(cb) { return onAuthStateChanged(auth, cb); }

window.PlatformAuth = { signIn, signOut, onChange };
export { signIn, signOut, onChange };
