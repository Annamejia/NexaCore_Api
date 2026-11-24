// Tienda pública y cuenta del cliente.
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { requireCliente } from '../auth.js'
import { one, pool, query, tx } from '../db.js'
import { DEVOLUCION_SELECT, PEDIDO_SELECT, PRODUCTO_SELECT, pedidoCompleto, productoConFotos } from '../queries.js'
import { ESTADO } from '../permissions.js'
import * as svc from '../services.js'
import { bad, checkPassword, NAME_RE, need, num, text, wrap } from '../util.js'

export const router = Router()

const idParam = (v) => {
  const n = num(v)
  if (!Number.isInteger(n) || n <= 0) throw bad('Identificador no válido.')
  return n
}

/* --------- público --------- */
router.get('/categorias', wrap(async (_req, res) => {
  res.json(
    await query(
      `SELECT c.*
       FROM categoria c
       WHERE EXISTS (
         SELECT 1 FROM producto p
         WHERE p.id_categoria = c.id_categoria AND p.estado = 'Activo'
       )
       ORDER BY c.nombre`
    )
  )
}))

// GET /api/tienda/productos?q=&id_categoria=&orden=nombre|precio_asc|precio_desc
router.get('/productos', wrap(async (req, res) => {
  const where = ["t.estado = 'Activo'"]
  const params = []
  if (req.query.q) {
    params.push(`%${req.query.q}%`)
    where.push(`t.nombre ILIKE $${params.length}`)
  }
  if (req.query.id_categoria) {
    params.push(idParam(req.query.id_categoria))
    where.push(`t.id_categoria = $${params.length}`)
  }
  const order = { precio_asc: 't.precio_venta ASC', precio_desc: 't.precio_venta DESC' }[req.query.orden] ?? 't.nombre ASC'
  res.json(
    await query(
      `SELECT t.id_producto, t.id_categoria, t.categoria, t.nombre, t.descripcion,
              t.precio_venta, t.existencia_actual, t.alerta_stock, t.foto_principal
       FROM (${PRODUCTO_SELECT}) t
       WHERE ${where.join(' AND ')}
       ORDER BY ${order}`,
      params
    )
  )
}))

router.get('/productos/:id', wrap(async (req, res) => {
  const { codigo_barra: _c, precio_compra: _p, stock_min: _a, stock_max: _b, ...publico } = await productoConFotos(idParam(req.params.id), true)
  res.json(publico)
}))

/* --------- cuenta del cliente --------- */
const MI_CUENTA = 'id_cliente, tipo_documento, documento, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, correo, telefono, departamento, municipio, direccion, estado'

router.get('/mi-cuenta', requireCliente, wrap(async (req, res) => {
  res.json(await one(`SELECT ${MI_CUENTA} FROM cliente WHERE id_cliente = $1`, [req.auth.id]))
}))

// El cliente puede cambiar sus nombres, sus datos de contacto y su contraseña (no el documento ni el correo).
router.put('/mi-cuenta', requireCliente, wrap(async (req, res) => {
  const b = req.body
  need(b, [['primer_nombre', 'primer nombre'], ['primer_apellido', 'primer apellido'], ['telefono', 'teléfono'], ['departamento', 'departamento'], ['municipio', 'municipio'], ['direccion', 'dirección']])
  for (const [k, label] of [['primer_nombre', 'primer nombre'], ['segundo_nombre', 'segundo nombre'], ['primer_apellido', 'primer apellido'], ['segundo_apellido', 'segundo apellido']]) {
    if (text(b[k]) && !NAME_RE.test(text(b[k]))) throw bad(`El ${label} solo puede tener letras.`)
  }
  if (!/^\d{7,12}$/.test(text(b.telefono).replace(/\s/g, ''))) throw bad('El teléfono debe tener entre 7 y 12 dígitos.')
  const campos = [
    'primer_nombre = $1',
    'segundo_nombre = $2',
    'primer_apellido = $3',
    'segundo_apellido = $4',
    'telefono = $5',
    'departamento = $6',
    'municipio = $7',
    'direccion = $8',
  ]
  const valores = [
    text(b.primer_nombre),
    text(b.segundo_nombre),
    text(b.primer_apellido),
    text(b.segundo_apellido),
    text(b.telefono).replace(/\s/g, ''),
    text(b.departamento),
    text(b.municipio),
    text(b.direccion),
  ]

  if (b.password) {
    const msg = checkPassword(b.password)
    if (msg) throw bad(msg)
    valores.push(await bcrypt.hash(b.password, 10))
    campos.push(`password = $${valores.length}`)
  }

  valores.push(req.auth.id)
  await pool.query(
    `UPDATE cliente SET ${campos.join(', ')} WHERE id_cliente = $${valores.length}`,
    valores
  )
  res.json(await one(`SELECT ${MI_CUENTA} FROM cliente WHERE id_cliente = $1`, [req.auth.id]))
}))

// Body: { direccion_envio, metodo_pago, items: [{ id_producto, cantidad }] }
// Los pedidos de la tienda se asignan a una sola persona: el primer Vendedor activo.
router.post('/pedidos', requireCliente, wrap(async (req, res) => {
  need(req.body, [['direccion_envio', 'dirección de envío'], ['metodo_pago', 'método de pago']])
  const vendedor = await one(
    `SELECT u.id_usuario
     FROM usuario u
     JOIN rol r ON r.id_rol = u.id_rol
     WHERE r.nombre = 'Vendedor' AND r.estado = 'Activo' AND u.estado = 'Activo'
     ORDER BY u.id_usuario
     LIMIT 1`
  )
  const id = await tx((conn) =>
    svc.crearPedido(conn, { ...req.body, id_cliente: req.auth.id, id_usuario: vendedor?.id_usuario ?? null })
  )
  res.status(201).json(await pedidoCompleto(id, req.auth.id))
}))

router.get('/mis-pedidos', requireCliente, wrap(async (req, res) => {
  res.json(await query(`${PEDIDO_SELECT} WHERE p.id_cliente = $1 ORDER BY p.id_pedido DESC`, [req.auth.id]))
}))

router.get('/mis-pedidos/:id', requireCliente, wrap(async (req, res) => {
  res.json(await pedidoCompleto(idParam(req.params.id), req.auth.id))
}))

// El cliente solo puede cancelar un pedido propio que siga Pendiente (el stock se devuelve).
router.post('/mis-pedidos/:id/cancelar', requireCliente, wrap(async (req, res) => {
  const pedidoId = idParam(req.params.id)
  const pedido = await pedidoCompleto(pedidoId, req.auth.id)
  if (pedido.id_estado_pedido !== ESTADO.PENDIENTE) throw bad('Solo puedes cancelar pedidos en estado Pendiente.')
  await tx((conn) => svc.cambiarEstadoPedido(conn, pedido.id_pedido, ESTADO.CANCELADO, { soloCliente: req.auth.id }))
  res.json(await pedidoCompleto(pedidoId, req.auth.id))
}))

router.post('/devoluciones', requireCliente, wrap(async (req, res) => {
  const b = req.body
  const id = await tx((conn) =>
    svc.crearDevolucion(
      conn,
      { id_pedido: num(b.id_pedido), id_producto: num(b.id_producto), cantidad: num(b.cantidad), motivo: b.motivo },
      { soloCliente: req.auth.id }
    )
  )
  res.status(201).json((await query(`${DEVOLUCION_SELECT} WHERE d.id_detalle_devolucion = $1`, [id]))[0])
}))

router.get('/mis-devoluciones', requireCliente, wrap(async (req, res) => {
  res.json(await query(`${DEVOLUCION_SELECT} WHERE p.id_cliente = $1 ORDER BY d.id_detalle_devolucion DESC`, [req.auth.id]))
}))