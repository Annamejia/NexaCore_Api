# NexaCore API (Node.js + Express + PostgreSQL)

API REST para conectar el frontend de NexaCore con la base de datos. Replica las reglas de negocio del prototipo:
stock que se mueve solo con compras/pedidos/devoluciones, estados de pedido y devolución, roles con permisos por módulo y privilegio, IVA configurable (hoy 0 %).

## Puesta en marcha
```bash
cd nexacore-api
npm install
# edita .env: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET...
npm run migrate           # crea la BD (DB_NAME) si no existe y las tablas de sql/schema.sql (se puede repetir)
npm run seed              # roles, privilegios, permisos, estados y el primer Administrador
npm run seed:demo         # (opcional) catálogo, compra inicial, pedidos, cliente y vendedor de demostración
npm run dev               # http://localhost:3000/api   (npm start en producción)
npm test                  # migra + seed:demo y corre las pruebas de extremo a extremo (usa la BD del .env)
```
Requiere Node 18+ y PostgreSQL 13+ (probado con PostgreSQL 17). El Administrador inicial sale de `ADMIN_EMAIL` / `ADMIN_PASSWORD` del `.env`
(la contraseña cumple las reglas: 10–20 caracteres y un carácter especial).
Cuentas de `seed:demo`: `carlos@nexacore.co / Vendedor2026*` (Vendedor) y `cliente@nexacore.co / Cliente2026*` (Cliente).

## Base de datos
`sql/schema.sql` sigue el script del equipo con estos ajustes (los mismos de `cambios_bd.sql` del frontend):
`Categoria` sin estado · `Rol.estado` · `Detalle_devolucion.estado` (Pendiente, En proceso, Finalizada, Rechazada) ·
`Rol_Permiso` con llave primaria `(id_rol, id_permiso, id_privilegio)` · `Proveedor.numero_documento` (sin tilde).
Las contraseñas se guardan con **bcrypt** (nunca en texto plano).

## Autenticación
`POST /api/auth/login` devuelve `{ token, session }`. Envía el token en cada petición: `Authorization: Bearer <token>`.
`session` incluye `kind` (`staff` o `cliente`), el rol y la lista de permisos `[módulo, privilegio]` para armar el menú.
Los permisos se **verifican en el servidor en cada petición** (si el rol o el usuario se desactiva, el acceso se pierde al instante).

Mensajes de error: JSON `{ "error": "texto en español" }` con 400 (datos), 401 (sin sesión/credenciales), 403 (sin permiso), 404, 409 (duplicado/en uso).

## Endpoints
| Módulo | Endpoints (prefijo `/api`) | Permiso |
|---|---|---|
| Auth | `POST /auth/login` · `POST /auth/register` (crea Cliente) · `GET /auth/me` | público / sesión |
| Categorías | `GET/POST /categorias` · `PUT/DELETE /categorias/:id` | Categorías |
| Productos | `GET/POST /productos` · `GET/PUT /productos/:id` · `PATCH /productos/:id/estado` · `POST /productos/:id/fotos` (multipart, campo `foto`) · `DELETE /productos/:id/fotos/:id_foto` | Productos |
| Proveedores | `GET/POST /proveedores` · `GET/PUT /proveedores/:id` · `PATCH /proveedores/:id/estado` | Proveedores |
| Compras (M/D) | `GET/POST /compras` · `GET/PUT /compras/:id` · `POST /compras/:id/anular` | Compras |
| Pedidos (M/D) | `GET/POST /pedidos` · `GET /pedidos/estados` · `GET/PUT /pedidos/:id` · `PATCH /pedidos/:id/estado` | Pedidos |
| Clientes | `GET/POST /clientes` · `GET/PUT /clientes/:id` · `PATCH /clientes/:id/estado` · `GET /clientes/:id/pedidos` | Clientes (historial = privilegio) |
| Devoluciones | `GET/POST /devoluciones` · `GET /devoluciones/elegibles` · `GET /devoluciones/:id` · `PATCH /devoluciones/:id/estado` | Devoluciones |
| Usuarios | `GET/POST /usuarios` · `GET/PUT /usuarios/:id` · `PATCH /usuarios/:id/estado` | Usuarios |
| Roles | `GET/POST /roles` · `GET/PUT /roles/:id` · `PUT /roles/:id/permisos` · `PATCH /roles/:id/estado` · `GET /permisos/catalogo` | Roles |
| Dashboard | `GET /dashboard?period=month\|6m\|all` | Dashboard |
| Tienda (público) | `GET /tienda/categorias` · `GET /tienda/productos?q=&id_categoria=&orden=` · `GET /tienda/productos/:id` | — |
| Cuenta cliente | `GET/PUT /tienda/mi-cuenta` · `POST /tienda/pedidos` · `GET /tienda/mis-pedidos[/:id]` · `POST /tienda/mis-pedidos/:id/cancelar` · `POST /tienda/devoluciones` · `GET /tienda/mis-devoluciones` | sesión de cliente |

Las fotos se guardan en `UPLOAD_DIR` y se sirven en `/uploads/<archivo>` (en `Galeria_fotos.url_imagen` queda esa ruta).

### Ejemplos de cuerpos
```jsonc
// POST /api/auth/register
{ "primer_nombre":"Ana","primer_apellido":"Gil","documento":"1020304050","correo":"ana@correo.com","telefono":"3001112233",
  "departamento":"Antioquia","municipio":"Medellín","direccion":"Calle 1","password":"Segura2026*x","confirm_password":"Segura2026*x" }

// POST /api/compras   (el precio de compra lo digita quien registra)
{ "id_proveedor":1, "fecha_compra":"2026-11-21", "items":[{ "id_producto":3, "cantidad":20, "precio_unitario":62000 }] }

// POST /api/pedidos   (el precio SIEMPRE sale de Producto.precio_venta; venta en mostrador = método "Efectivo")
{ "id_cliente":1, "direccion_envio":"Calle 10 # 20-30", "metodo_pago":"Efectivo", "items":[{ "id_producto":3, "cantidad":2 }] }

// PATCH /api/pedidos/:id/estado   (2 En proceso · 3 Entregado · 4 Cancelado → devuelve el stock)
{ "id_estado_pedido": 4 }

// POST /api/devoluciones   (pedido Entregado; cantidad ≤ vendida − ya devuelta)
{ "id_pedido":12, "id_producto":3, "cantidad":1, "motivo":"Falla de carga" }

// PATCH /api/devoluciones/:id/estado   (Finalizada devuelve el producto al stock)
{ "estado": "Finalizada" }

// PUT /api/roles/:id/permisos   (solo combinaciones válidas; "Consultar" se agrega solo)
{ "permisos": [["Pedidos","Consultar"],["Pedidos","Cambiar estado"],["Dashboard","Consultar"]] }
```

## Reglas de negocio (en el servidor, dentro de transacciones)
- `existencia_actual` **no se edita**: Compra (+) · Pedido (− al registrar) · Cancelar pedido (+) · Anular compra (−, falla si ya se vendió) · Devolución Finalizada (+; al salir de Finalizada vuelve a restar).
- Las filas de producto se bloquean (`FOR UPDATE`) en cada movimiento: dos pedidos simultáneos por la última unidad → uno gana y el otro recibe 400. El stock nunca queda negativo.
- Pedido: estados `Pendiente → En proceso → Entregado`, o `Cancelado` desde Pendiente/En proceso. Solo se edita en `Pendiente`. Los pedidos de la tienda se asignan al primer Vendedor activo.
- Devolución: solo sobre pedidos `Entregado`; estados `Pendiente`, `En proceso`, `Finalizada`, `Rechazada`. No hay garantía.
- Ventas no existe como módulo: una venta es un pedido En proceso o Entregado.
- IVA: `IVA_RATE=0` en `.env` (la empresa no cobra IVA). Igual se guardan `iva` e `iva_producto`; si algún día cambia, se ajusta ese valor.
- Rol: no se desactiva `Administrador` ni un rol con usuarios activos; siempre queda al menos un Administrador activo; los permisos del Administrador no se editan.

## Conexión con el frontend (nexacore-react)
- `GET /api/estado` devuelve las tablas que la sesión puede ver (público, cliente o personal según sus permisos), sin contraseñas.
  El frontend arma sus pantallas con ellas (`src/lib/db.js`) y cada cambio va al endpoint REST del módulo.
- En desarrollo Vite redirige `/api` y `/uploads` a `http://localhost:3000` (`vite.config.js`), así que no hace falta CORS.
  Si el frontend llama a la API directamente (`VITE_API_URL`), define `CORS_ORIGIN` con su URL.
- Extras para el panel: `POST /auth/register` con `tipo: "vendedor" | "administrador"` crea un usuario **Inactivo**;
  `PATCH /pedidos/:id/responsable` cambia el responsable; `POST /pedidos` acepta `id_usuario` (responsable).
