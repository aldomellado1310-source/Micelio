# Veritest

Verificación de diplomas y certificados. Un emisor **genera** diplomas o **entrega
diplomas ya hechos**; Veritest los registra, les pega un QR y permite que
cualquiera compruebe después si un diploma está registrado.

Vive en esta carpeta, **autocontenida**: tiene su propio `functions/`, hosting,
reglas y configuración de Firebase, y no toca `functions/`, `firestore.rules` ni
`public/` del sistema de reservas (Scissor White / Micelio). Se puede sacar a un
repo propio sin cambios. Va en **su propio proyecto Firebase** (ni `scissor-white`
ni `registrago001`; ver `CLAUDE.md`): los scripts de administración se niegan a
correr contra esos dos.

## Qué hace y qué NO hace

- **Veritest solo verifica lo que un emisor autenticado registró.** No detecta un
  diploma falsificado que nadie registró.
- **El QR prueba que "existe un registro con este id", no que ESTE documento sea
  ese registro.** Alguien podría copiar un QR válido sobre un diploma falso. Por
  eso la ficha muestra titular, diploma y emisor para compararlos con el papel, y
  por eso existe la verificación por **huella SHA-256 del archivo** (byte a byte).
- Si el PDF se modifica, se reimprime o se convierte, su huella cambia: no
  coincidirá aunque el diploma sea real. Ahí vale el QR y los datos de la ficha.
- Se guardan **dos huellas** por diploma: la del PDF tal como llegó y la del PDF
  sellado que se entregó (el sellado cambia los bytes). Se reconoce cualquiera de
  las dos, y la página avisa cuál es la versión oficial.
- **El PDF no se guarda.** Solo huellas y los datos que el diploma ya muestra
  impresos (titular, qué certifica, folio, fecha, emisor).
- **La verificación falla cerrada**: si la consulta no se puede completar, la
  página lo dice; jamás muestra "vigente" por omisión.

## Piezas

| Pieza | Para qué |
|---|---|
| `functions/lib/` | El núcleo (sin Firebase): ids, huellas, QR, sellado de PDF, registro, vista pública. |
| `functions/index.js` | `verify` (HTTP público, `/api/verify`) y `registerDiploma` (callable, solo emisores). |
| `public/` | `index.html` (verificar por archivo), `v/index.html` (ficha del QR), `issuer/` (panel del emisor). |
| `cli/veritest.js` | Lotes: `preview`, `stamp`, `generate`, `verify`. |
| `templates/ejemplo/` | Plantilla de certificado neutra para `generate`. |
| `functions/scripts/` | `setIssuer.js` (habilitar emisores), `importRegistry.js` (cargar el registro local a Firestore). |

Modelo de datos (solo Admin SDK; `firestore.rules` niega todo acceso de cliente):
`diplomas/{id}`, `hashes/{sha256}` (índice huella → id), `issuers/{issuerId}`.

El id del QR son **16 bytes aleatorios** (22 caracteres base64url), no el folio:
un folio correlativo permitiría recorrer los diplomas de otras personas.

## Poner un diploma ya hecho: elegir dónde va el QR

Cada diploma tiene su propio diseño y **el sellador no puede ver qué hay debajo
de la tarjeta** (blanca, ~24 × 33 mm con QR de 17–18 mm). La esquina y los
márgenes son parámetros; revisa siempre el resultado.

```bash
# 1) Vista previa de UN PDF -- no registra nada, no gasta ids
node cli/veritest.js preview --pdf diploma.pdf --out preview.pdf \
     --corner tr --margin-x 22 --margin-y 41 --qr-mm 17

# 2) Cuando la posición sea buena, el lote completo
node cli/veritest.js stamp --list lista.json --in originales/ --out sellados/ \
     --registry veritest-registry.jsonl \
     --issuer samu-talcahuano --issuer-name "SAMU SS Talcahuano" \
     --corner tr --margin-x 22 --margin-y 41 --qr-mm 17
```

`lista.json`: `[{ "file": "x.pdf", "holderName": "…", "title": "…", "folio": "…", "issuedOn": "AAAA-MM-DD" }]`.
Es idempotente: volver a correr el mismo lote no duplica registros ni sella dos
veces (informa `YA ESTABA`). Los originales no se tocan (`--out` debe ser otra
carpeta). Un error en una entrada no detiene el lote y deja exit code 1.

## Generar diplomas desde una plantilla

```bash
npm i playwright && npx playwright install chromium     # una vez
node cli/veritest.js generate --list lista.json --template templates/ejemplo/certificado.html \
     --out sellados/ --registry veritest-registry.jsonl \
     --issuer samu-talcahuano --issuer-name "SAMU SS Talcahuano" \
     --corner tr --margin-x 12 --margin-y 12
```

Cada entrada puede llevar `"params": {…}`: son los parámetros de query que recibe la
plantilla (como `generar.js` de las Jornadas SAMU28). Regla para una plantilla propia:
**dejar libre una esquina** de ~30 × 36 mm para la tarjeta del QR.

## ⚠️ Antes de emitir diplomas reales

1. **El dominio.** El QR codifica `https://veritest.cl/v/<id>` (`VERITEST_BASE_URL`,
   por defecto `https://veritest.cl`). **Un QR impreso no se puede corregir.** No
   emitas diplomas reales hasta que `veritest.cl` sea tuyo y esté sirviendo este
   hosting. Para pruebas usa una base de prueba: `--base-url http://localhost:5003`.
2. **El proyecto Firebase.** Todavía no existe. Reemplazar los placeholders de
   `.firebaserc` y `public/js/firebase-init-veritest.js`.
3. **Probar contra Firebase de verdad.** La verificación en navegador se hizo con el
   SDK de Firebase reemplazado por un stub (ver más abajo). Autenticación real,
   claims reales y despliegue siguen pendientes.

## Puesta en marcha (la hace Aldo; nada se despliega desde aquí)

```bash
cd veritest
# 0) crear el proyecto Firebase de Veritest; poner su id en .firebaserc
# 1) habilitar a un emisor (crea issuers/<id> y le pone el claim a la cuenta)
cd functions && npm ci
node scripts/setIssuer.js --project <proyecto-veritest> \
     --email persona@dominio.cl --issuer samu-talcahuano --name "SAMU SS Talcahuano"
# 2) cargar el registro que produjo el CLI (opcional, idempotente)
node scripts/importRegistry.js --project <proyecto-veritest> --registry ../veritest-registry.jsonl --dry-run
# 3) desplegar
cd .. && firebase deploy --only functions,hosting,firestore --project <proyecto-veritest>
```

`functions/.env` (no se versiona): `VERITEST_BASE_URL=https://veritest.cl`.

Límites de abuso: `verify` es público y sin autenticación; la protección es que los
ids y las huellas no se pueden adivinar (128 / 256 bits) y `maxInstances`. No hay
rate limiting propio todavía.

## Pruebas

```bash
cd functions && npm test        # 54 tests, node --test: núcleo, sellado, registro, almacenes, CLI, scripts
node tests/e2e.cjs              # navegador real (Playwright): panel, ficha, subida de archivos, caminos negativos
```

- `npm test` incluye una prueba que **renderiza el PDF sellado con `pdftoppm` y
  decodifica el QR con jsQR** en las cuatro esquinas sobre fondo oscuro (se omite
  si no hay `pdftoppm`), y el `generate` real con Chromium (se omite sin Playwright).
- `tests/e2e.cjs` usa los mismos handlers que las Cloud Functions con un registro en
  memoria, y **reemplaza el SDK de Firebase por un stub** (no hay acceso a
  `gstatic.com` desde todos los entornos).
- Las pruebas se validaron con bugs deliberados (se revirtieron): sin chequeo de
  duplicados, QR que codifica el id en vez de la URL, vista pública que filtra la
  huella, emisor suspendido que registra, `db.get()` suelto dentro de una
  transacción.

## Fuera de alcance (siguientes pasos naturales)

- **Revocación** de un diploma (el campo `status` y la ficha ya la soportan; falta el callable).
- Listado de los diplomas de un emisor en el panel, y alta masiva desde el panel.
- Páginas con `/Rotate` (hoy se rechazan con un mensaje claro).
- Rate limiting de `verify`.
- Datos personales: el registro lleva nombres y la ficha es pública para quien tenga el
  QR o el archivo (el mismo dato que ya está impreso en el diploma). Definir una
  política de retención y de baja a solicitud del titular.
