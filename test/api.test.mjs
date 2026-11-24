// Pruebas de extremo a extremo. Requisitos: base migrada y con `npm run seed:demo`. Uso: npm test
import { app } from '../src/app.js'
import { pool } from '../src/db.js'

const server = app.listen(0)
const base = `http://127.0.0.1:${server.address().port}/api`
let fails = 0
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`) }
const call = async (method, path, { token, body, form } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json }
}
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } }))
const tag = Date.now().toString().slice(-7)

try {
  // ---------- auth ----------
  ok('health', (await call('GET', '/health')).body?.ok === true)
  const adminL = await login('admin@nexacore.co', 'Admin2026*')
  const A = adminL.body.token
  ok('login admin', adminL.status === 200 && adminL.body.session.rol === 'Administrador' && adminL.body.session.permisos.length > 20)
  const vend = await login('carlos@nexacore.co', 'Vendedor2026*')
  const V = vend.body.token
  ok('login vendedor', vend.status === 200 && vend.body.session.rol === 'Vendedor')
  const cliL = await login('cliente@nexacore.co', 'Cliente2026*')
  const C = cliL.body.token
  ok('login cliente', cliL.status === 200 && cliL.body.session.kind === 'cliente')
  const bad = await login('cliente@nexacore.co', 'Mala12345*')
  ok('clave incorrecta → 401', bad.status === 401 && /incorrectos/.test(bad.body.error))
  const unknown = await login('nadie@nexacore.co', 'Mala12345*')
  ok('no registrado → 401', unknown.status === 401 && /No has sido registrado/.test(unknown.body.error))
  ok('sin token → 401', (await call('GET', '/pedidos')).status === 401)
  ok('token inválido → 401', (await call('GET', '/pedidos', { token: 'xxx' })).status === 401)
  ok('me', (await call('GET', '/auth/me', { token: A })).body.session.id_rol === 1)

  const reg = { primer_nombre: 'Ana', primer_apellido: 'Gil', documento: `10${tag}`, correo: `ana${tag}@test.com`, telefono: '3001112233', departamento: 'Antioquia', municipio: 'Medellín', direccion: 'Calle 1', password: 'Segura2026*x', confirm_password: 'Segura2026*x' }
  ok('registro: contraseña corta', (await call('POST', '/auth/register', { body: { ...reg, password: 'Ab1*', confirm_password: 'Ab1*' } })).status === 400)
  ok('registro: sin especial', (await call('POST', '/auth/register', { body: { ...reg, password: 'Segura2026xx', confirm_password: 'Segura2026xx' } })).status === 400)
  ok('registro: no coinciden', (await call('POST', '/auth/register', { body: { ...reg, confirm_password: 'otra' } })).status === 400)
  ok('registro: campos vacíos', (await call('POST', '/auth/register', { body: { ...reg, primer_nombre: '' } })).status === 400)
  const r = await call('POST', '/auth/register', { body: reg })
  ok('registro ok + sesión', r.status === 201 && r.body.session.kind === 'cliente' && !!r.body.token)
  ok('registro duplicado → 409', (await call('POST', '/auth/register', { body: reg })).status === 409)
  ok('login tras registro', (await login(reg.correo, reg.password)).status === 200)
  ok('password nunca viaja en la respuesta', !JSON.stringify(r.body).includes('password'))

  // ---------- permisos ----------
  ok('vendedor NO ve compras', (await call('GET', '/compras', { token: V })).status === 403)
  ok('vendedor ve pedidos', (await call('GET', '/pedidos', { token: V })).status === 200)
  ok('cliente NO ve pedidos del panel', (await call('GET', '/pedidos', { token: C })).status === 403)
  ok('cliente NO ve dashboard', (await call('GET', '/dashboard', { token: C })).status === 403)
  ok('vendedor NO crea usuarios', (await call('POST', '/usuarios', { token: V, body: {} })).status === 403)

  // ---------- categorías / productos ----------
  const cat = await call('POST', '/categorias', { token: A, body: { nombre: `Cat ${tag}` } })
  ok('crear categoría', cat.status === 201)
  ok('categoría duplicada → 409', (await call('POST', '/categorias', { token: A, body: { nombre: `Cat ${tag}` } })).status === 409)
  const prod = await call('POST', '/productos', { token: A, body: { id_categoria: cat.body.id_categoria, codigo_barra: `T${tag}`, nombre: `Prod ${tag}`, descripcion: 'x', stock_min: 5, stock_max: 50, precio_compra: 1000, precio_venta: 2000, existencia_actual: 999 } })
  ok('producto nuevo nace con existencia 0 (ignora la enviada)', prod.status === 201 && prod.body.existencia_actual === 0)
  const P = prod.body.id_producto
  const upd = await call('PUT', `/productos/${P}`, { token: A, body: { id_categoria: cat.body.id_categoria, codigo_barra: `T${tag}`, nombre: `Prod ${tag} v2`, stock_min: 5, stock_max: 50, precio_compra: 1000, precio_venta: 2500, existencia_actual: 777 } })
  ok('editar producto no toca existencia', upd.status === 200 && upd.body.existencia_actual === 0 && upd.body.precio_venta === 2500)
  ok('stock máx < mín → 400', (await call('PUT', `/productos/${P}`, { token: A, body: { id_categoria: cat.body.id_categoria, codigo_barra: `T${tag}`, nombre: 'x', stock_min: 9, stock_max: 2, precio_venta: 1 } })).status === 400)
  ok('no eliminar categoría con productos → 409', (await call('DELETE', `/categorias/${cat.body.id_categoria}`, { token: A })).status === 409)
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
  const fd = new FormData(); fd.append('foto', new Blob([png], { type: 'image/png' }), 'a.png')
  const foto = await call('POST', `/productos/${P}/fotos`, { token: A, form: fd })
  ok('subir foto', foto.status === 201 && foto.body.fotos.length === 1 && foto.body.foto_principal.startsWith('/uploads/'))
  const fd2 = new FormData(); fd2.append('foto', new Blob(['hola'], { type: 'text/plain' }), 'a.txt')
  ok('rechaza archivo que no es imagen', (await call('POST', `/productos/${P}/fotos`, { token: A, form: fd2 })).status === 400)
  const served = await fetch(base.replace('/api', '') + foto.body.foto_principal)
  ok('la foto se sirve en /uploads', served.status === 200)
  ok('borrar foto', (await call('DELETE', `/productos/${P}/fotos/${foto.body.fotos[0].id_galeria_fotos}`, { token: A })).status === 204)

  // ---------- proveedor / compras ----------
  const prov = await call('POST', '/proveedores', { token: A, body: { razon_social: `Prov ${tag}`, numero_documento: `9${tag}`, correo: 'p@p.co' } })
  ok('crear proveedor', prov.status === 201)
  const PV = prov.body.id_proveedor
  const stockDe = async (id) => (await call('GET', `/productos/${id}`, { token: A })).body.existencia_actual
  const compra = await call('POST', '/compras', { token: A, body: { id_proveedor: PV, fecha_compra: '2026-11-01', items: [{ id_producto: P, cantidad: 10, precio_unitario: 1000 }] } })
  ok('compra suma stock', compra.status === 201 && (await stockDe(P)) === 10 && compra.body.total === 10000 && compra.body.iva === 0)
  ok('compra sin ítems → 400', (await call('POST', '/compras', { token: A, body: { id_proveedor: PV, fecha_compra: '2026-11-01', items: [] } })).status === 400)
  ok('compra sin precio → 400', (await call('POST', '/compras', { token: A, body: { id_proveedor: PV, fecha_compra: '2026-11-01', items: [{ id_producto: P, cantidad: 1 }] } })).status === 400)
  const compraUp = await call('PUT', `/compras/${compra.body.id_compra}`, { token: A, body: { id_proveedor: PV, fecha_compra: '2026-11-02', items: [{ id_producto: P, cantidad: 12, precio_unitario: 1100 }] } })
  ok('editar compra ajusta stock', compraUp.status === 200 && (await stockDe(P)) === 12)
  const anul = await call('POST', `/compras/${compra.body.id_compra}/anular`, { token: A })
  ok('anular compra revierte', anul.status === 200 && anul.body.estado === 'Anulada' && (await stockDe(P)) === 0)
  ok('anular dos veces → 400', (await call('POST', `/compras/${compra.body.id_compra}/anular`, { token: A })).status === 400)
  await call('POST', '/compras', { token: A, body: { id_proveedor: PV, fecha_compra: '2026-11-03', items: [{ id_producto: P, cantidad: 6, precio_unitario: 1000 }] } })
  const c2 = (await call('GET', '/compras', { token: A })).body.find((c) => c.estado === 'Registrada' && c.id_proveedor === PV)

  // ---------- pedidos ----------
  const cliId = cliL.body.session.id
  const pedBody = { id_cliente: cliId, direccion_envio: 'Calle 1', metodo_pago: 'Efectivo', items: [{ id_producto: P, cantidad: 2, precio_unitario: 1 }] }
  const ped = await call('POST', '/pedidos', { token: V, body: pedBody })
  ok('pedido resta stock y usa el precio de la BD', ped.status === 201 && (await stockDe(P)) === 4 && ped.body.items[0].precio_unitario === 2500 && ped.body.total === 5000 && ped.body.iva === 0)
  ok('pedido guarda quién lo atendió', ped.body.id_usuario === vend.body.session.id)
  ok('stock insuficiente → 400', (await call('POST', '/pedidos', { token: V, body: { ...pedBody, items: [{ id_producto: P, cantidad: 99 }] } })).status === 400)
  const pedUp = await call('PUT', `/pedidos/${ped.body.id_pedido}`, { token: V, body: { ...pedBody, items: [{ id_producto: P, cantidad: 4 }] } })
  ok('editar pedido ajusta stock', pedUp.status === 200 && (await stockDe(P)) === 2)
  ok('anular compra ya vendida → 400', (await call('POST', `/compras/${c2.id_compra}/anular`, { token: A })).status === 400)
  const canc = await call('PATCH', `/pedidos/${ped.body.id_pedido}/estado`, { token: V, body: { id_estado_pedido: 4 } })
  ok('cancelar pedido devuelve stock', canc.status === 200 && (await stockDe(P)) === 6)
  ok('cancelado es final', (await call('PATCH', `/pedidos/${ped.body.id_pedido}/estado`, { token: V, body: { id_estado_pedido: 2 } })).status === 400)
  ok('no se edita un pedido cancelado', (await call('PUT', `/pedidos/${ped.body.id_pedido}`, { token: V, body: pedBody })).status === 400)

  // carrera: dos pedidos a la vez por las últimas 6 unidades (4 + 4)
  const [r1, r2] = await Promise.all([1, 2].map(() => call('POST', '/pedidos', { token: V, body: { ...pedBody, items: [{ id_producto: P, cantidad: 4 }] } })))
  ok('concurrencia: solo uno gana y el stock nunca es negativo', [r1.status, r2.status].sort().join() === '201,400' && (await stockDe(P)) === 2)
  const ganador = [r1, r2].find((x) => x.status === 201)
  for (const e of [2, 3]) await call('PATCH', `/pedidos/${ganador.body.id_pedido}/estado`, { token: V, body: { id_estado_pedido: e } })
  const entregado = (await call('GET', `/pedidos/${ganador.body.id_pedido}`, { token: V })).body
  ok('pedido llega a Entregado con fecha de entrega', entregado.estado === 'Entregado' && !!entregado.fecha_entrega)

  // ---------- tienda y cliente ----------
  const lista = await call('GET', '/tienda/productos')
  ok('tienda pública lista productos activos sin datos internos', lista.status === 200 && lista.body.length >= 6 && !('precio_compra' in lista.body[0]))
  const detalle = await call('GET', `/tienda/productos/${P}`)
  ok('detalle público sin precio de compra', detalle.status === 200 && !('precio_compra' in detalle.body) && !('codigo_barra' in detalle.body))
  const mio = await call('POST', '/tienda/pedidos', { token: C, body: { direccion_envio: 'Mi casa', metodo_pago: 'PSE', items: [{ id_producto: P, cantidad: 1 }] } })
  ok('cliente crea su pedido (asignado a un vendedor)', mio.status === 201 && mio.body.id_cliente === cliId && mio.body.id_usuario === vend.body.session.id && (await stockDe(P)) === 1)
  ok('cliente ve sus pedidos', (await call('GET', '/tienda/mis-pedidos', { token: C })).body.some((p) => p.id_pedido === mio.body.id_pedido))
  const ajeno = await call('GET', `/tienda/mis-pedidos/${ganador.body.id_pedido}`, { token: (await login(reg.correo, reg.password)).body.token })
  ok('cliente NO ve pedidos ajenos', ajeno.status === 404)
  ok('cliente cancela su pedido Pendiente', (await call('POST', `/tienda/mis-pedidos/${mio.body.id_pedido}/cancelar`, { token: C })).status === 200 && (await stockDe(P)) === 2)
  ok('cliente NO puede devolver un pedido no entregado', (await call('POST', '/tienda/devoluciones', { token: C, body: { id_pedido: mio.body.id_pedido, id_producto: P, cantidad: 1, motivo: 'x' } })).status === 400)

  // ---------- devoluciones ----------
  const dev = await call('POST', '/tienda/devoluciones', { token: C, body: { id_pedido: ganador.body.id_pedido, id_producto: P, cantidad: 2, motivo: 'Falla' } })
  ok('cliente solicita devolución (nace Pendiente)', dev.status === 201 && dev.body.estado === 'Pendiente')
  const D = dev.body.id_detalle_devolucion
  ok('devolver más de lo vendido → 400', (await call('POST', '/devoluciones', { token: A, body: { id_pedido: ganador.body.id_pedido, id_producto: P, cantidad: 3, motivo: 'x' } })).status === 400)
  ok('elegibles refleja lo devolvible', (await call('GET', '/devoluciones/elegibles', { token: A })).body.filter((e) => e.id_pedido === ganador.body.id_pedido).every((e) => e.devolvible === 2))
  const est = (estado) => call('PATCH', `/devoluciones/${D}/estado`, { token: A, body: { estado } })
  ok('estado inválido → 400', (await est('Aprobada')).status === 400)
  ok('En proceso no toca stock', (await est('En proceso')).status === 200 && (await stockDe(P)) === 2)
  ok('Finalizada devuelve al stock', (await est('Finalizada')).status === 200 && (await stockDe(P)) === 4)
  ok('volver a Pendiente revierte', (await est('Pendiente')).status === 200 && (await stockDe(P)) === 2)
  ok('Rechazada libera la cantidad', (await est('Rechazada')).status === 200 && (await call('GET', '/devoluciones/elegibles', { token: A })).body.some((e) => e.id_pedido === ganador.body.id_pedido && e.devolvible === 4))
  ok('vendedor NO cambia estado de devoluciones', (await call('PATCH', `/devoluciones/${D}/estado`, { token: V, body: { estado: 'Finalizada' } })).status === 403)

  // ---------- usuarios / roles ----------
  const catalogo = await call('GET', '/permisos/catalogo', { token: A })
  ok('catálogo de permisos (Dashboard solo consultar)', catalogo.body.modulos.Dashboard.join() === 'Consultar')
  const rol = await call('POST', '/roles', { token: A, body: { nombre: `Rol ${tag}`, descripcion: 'x', permisos: [['Pedidos', 'Cambiar estado']] } })
  ok('crear rol (agrega Consultar implícito)', rol.status === 201 && rol.body.permisos.some((p) => p.modulo === 'Pedidos' && p.privilegio === 'Consultar'))
  ok('combinación inválida → 400', (await call('PUT', `/roles/${rol.body.id_rol}/permisos`, { token: A, body: { permisos: [['Dashboard', 'Crear']] } })).status === 400)
  ok('permisos del Administrador no se editan', (await call('PUT', '/roles/1/permisos', { token: A, body: { permisos: [] } })).status === 400)
  ok('no desactivar rol Administrador', (await call('PATCH', '/roles/1/estado', { token: A, body: { estado: 'Inactivo' } })).status === 400)
  const user = await call('POST', '/usuarios', { token: A, body: { id_rol: rol.body.id_rol, numero_documento: `7${tag}`, primer_nombre: 'Luis', primer_apellido: 'Paz', correo: `luis${tag}@nexacore.co`, password: 'Clave2026*xx' } })
  ok('crear usuario con rol elegido de la lista', user.status === 201 && user.body.rol === `Rol ${tag}` && !('password' in user.body))
  ok('usuario sin rol válido → 400', (await call('POST', '/usuarios', { token: A, body: { id_rol: 9999, numero_documento: `8${tag}`, primer_nombre: 'X', primer_apellido: 'Y', correo: `x${tag}@a.co`, password: 'Clave2026*xx' } })).status === 400)
  const lu = await login(`luis${tag}@nexacore.co`, 'Clave2026*xx')
  ok('el nuevo usuario entra con sus permisos', lu.status === 200 && (await call('GET', '/pedidos', { token: lu.body.token })).status === 200 && (await call('GET', '/compras', { token: lu.body.token })).status === 403)
  ok('desactivar rol con usuarios activos → 400', (await call('PATCH', `/roles/${rol.body.id_rol}/estado`, { token: A, body: { estado: 'Inactivo' } })).status === 400)
  await call('PATCH', `/usuarios/${user.body.id_usuario}/estado`, { token: A, body: { estado: 'Inactivo' } })
  ok('usuario inactivo no puede entrar', (await login(`luis${tag}@nexacore.co`, 'Clave2026*xx')).status === 403)
  ok('token de usuario inactivo pierde acceso', (await call('GET', '/pedidos', { token: lu.body.token })).status === 403)
  ok('no desactivar al último administrador', (await call('PATCH', `/usuarios/${adminL.body.session.id}/estado`, { token: A, body: { estado: 'Inactivo' } })).status === 400)

  // ---------- clientes / dashboard ----------
  ok('historial de compras (privilegio) del vendedor', (await call('GET', `/clientes/${cliId}/pedidos`, { token: V })).status === 200)
  ok('lista de clientes sin password', !JSON.stringify((await call('GET', '/clientes', { token: A })).body).includes('password'))
  const dash = await call('GET', '/dashboard?period=6m', { token: A })
  ok('dashboard completo para admin', dash.status === 200 && dash.body.ventas_vs_compras?.length === 6 && Array.isArray(dash.body.rentabilidad_categoria) && dash.body.kpis.productos_total >= 6)
  const dashV = await call('GET', '/dashboard', { token: V })
  ok('dashboard del vendedor oculta compras y rentabilidad', dashV.status === 200 && !('ventas_vs_compras' in dashV.body) && !('rentabilidad_categoria' in dashV.body))
  ok('ruta inexistente → 404 JSON', (await call('GET', '/nada', { token: A })).status === 404)
} catch (error) {
  fails++
  console.error('ERROR en la prueba:', error)
} finally {
  server.close()
  await pool.end()
  console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK')
  process.exit(fails ? 1 : 0)
}