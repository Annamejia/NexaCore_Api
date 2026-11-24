// Compras y Pedidos (maestro/detalle) y Devoluciones. El stock lo mueven los servicios en una transacción.
import { Router } from 'express'
import { requireCan } from '../auth.js'
import { one, query, tx } from '../db.js'
import { COMPRA_SELECT, DEVOLUCION_SELECT, compraCompleta, PEDIDO_SELECT, pedidoCompleto } from '../queries.js'
import { ESTADOS_DEVOLUCION } from '../permissions.js'
import * as svc from '../services.js'
import { bad, notFound, num, wrap } from '../util.js'

export const router = Router()

const ymd = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : null)

/* ------------------------------- Compras ------------------------------- */

// GET /api/compras?estado=&id_proveedor=&desde=&hasta=
router.get('/compras', requireCan(['Compras', 'Consultar']), wrap(async (req, res) => {
  const where = []
  const params = []
  if (req.query.estado) {
    params.push(req.query.estado)
    where.push(`c.estado = $${params.length}`)
  }
  if (req.query.id_proveedor) {
    params.push(req.query.id_proveedor)
    where.push(`c.id_proveedor = $${params.length}`)
  }
  if (ymd(req.query.desde)) {
    params.push(req.query.desde)
    where.push(`c.fecha_compra >= $${params.length}`)
  }
  if (ymd(req.query.hasta)) {
    params.push(req.query.hasta)
    where.push(`c.fecha_compra < ($${params.length}::timestamp + INTERVAL '1 day')`)
  }
  res.json(await query(`${COMPRA_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id_compra DESC`, params))
}))

router.get('/compras/:id', requireCan(['Compras', 'Consultar']), wrap(async (req, res) => {
  res.json(await compraCompleta(req.params.id))
}))

// Body: { id_proveedor, fecha_compra: 'AAAA-MM-DD', items: [{ id_producto, cantidad, precio_unitario }] }
router.post('/compras', requireCan(['Compras', 'Crear']), wrap(async (req, res) => {
  const id = await tx((conn) => svc.crearCompra(conn, req.body))
  res.status(201).json(await compraCompleta(id))
}))

router.put('/compras/:id', requireCan(['Compras', 'Editar']), wrap(async (req, res) => {
  await tx((conn) => svc.actualizarCompra(conn, Number(req.params.id), req.body))
  res.json(await compraCompleta(req.params.id))
}))

router.post('/compras/:id/anular', requireCan(['Compras', 'Anular']), wrap(async (req, res) => {
  await tx((conn) => svc.anularCompra(conn, Number(req.params.id)))
  res.json(await compraCompleta(req.params.id))
}))

/* ------------------------------- Pedidos ------------------------------- */

// GET /api/pedidos?id_estado_pedido=&id_cliente=&desde=&hasta=
router.get('/pedidos', requireCan(['Pedidos', 'Consultar']), wrap(async (req, res) => {
  const where = []
  const params = []
  if (req.query.id_estado_pedido) {
    params.push(req.query.id_estado_pedido)
    where.push(`p.id_estado_pedido = $${params.length}`)
  }
  if (req.query.id_cliente) {
    params.push(req.query.id_cliente)
    where.push(`p.id_cliente = $${params.length}`)
  }
  if (ymd(req.query.desde)) {
    params.push(req.query.desde)
    where.push(`p.fecha_pedido >= $${params.length}`)
  }
  if (ymd(req.query.hasta)) {
    params.push(req.query.hasta)
    where.push(`p.fecha_pedido < ($${params.length}::timestamp + INTERVAL '1 day')`)
  }
  res.json(await query(`${PEDIDO_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id_pedido DESC`, params))
}))

router.get('/pedidos/estados', requireCan(['Pedidos', 'Consultar']), wrap(async (_req, res) => {
  res.json(await query('SELECT * FROM estado_pedido ORDER BY id_estado_pedido'))
}))

router.get('/pedidos/:id', requireCan(['Pedidos', 'Consultar']), wrap(async (req, res) => {
  res.json(await pedidoCompleto(req.params.id))
}))

// Body: { id_cliente, direccion_envio, metodo_pago, items: [{ id_producto, cantidad }] }
// El precio sale de Producto.precio_venta. Una venta en mostrador = pedido con método "Efectivo".
// id_usuario (opcional) = responsable; si no llega, queda quien registra el pedido.
router.post('/pedidos', requireCan(['Pedidos', 'Crear']), wrap(async (req, res) => {
  const responsable = await responsableValido(req.body.id_usuario, req.auth.id)
  const id = await tx((conn) => svc.crearPedido(conn, { ...req.body, id_cliente: num(req.body.id_cliente), id_usuario: responsable }))
  res.status(201).json(await pedidoCompleto(id))
}))

// Body: { id_usuario }  (null = sin asignar)
router.patch('/pedidos/:id/responsable', requireCan(['Pedidos', 'Editar'], ['Pedidos', 'Cambiar estado']), wrap(async (req, res) => {
  const responsable = await responsableValido(req.body.id_usuario, null)
  const r = await query('UPDATE pedido SET id_usuario = $1 WHERE id_pedido = $2 RETURNING id_pedido', [responsable, Number(req.params.id)])
  if (!r.length) throw notFound('El pedido no existe.')
  res.json(await pedidoCompleto(req.params.id))
}))

async function responsableValido(valor, defecto) {
  if (valor === undefined || valor === '' || valor === null) return defecto
  const id = num(valor)
  if (!Number.isInteger(id)) throw bad('Selecciona un responsable válido.')
  const u = await one("SELECT 1 FROM usuario WHERE id_usuario = $1 AND estado = 'Activo'", [id])
  if (!u) throw bad('El responsable debe ser un usuario activo.')
  return id
}

router.put('/pedidos/:id', requireCan(['Pedidos', 'Editar']), wrap(async (req, res) => {
  await tx((conn) => svc.actualizarPedido(conn, Number(req.params.id), { ...req.body, id_cliente: req.body.id_cliente === undefined ? undefined : num(req.body.id_cliente) }))
  res.json(await pedidoCompleto(req.params.id))
}))

// Body: { id_estado_pedido }  (2 En proceso, 3 Entregado, 4 Cancelado → cancelar devuelve el stock)
router.patch('/pedidos/:id/estado', requireCan(['Pedidos', 'Cambiar estado']), wrap(async (req, res) => {
  const nuevo = num(req.body.id_estado_pedido)
  if (!Number.isInteger(nuevo)) throw bad('Indica el nuevo estado del pedido.')
  await tx((conn) => svc.cambiarEstadoPedido(conn, Number(req.params.id), nuevo))
  res.json(await pedidoCompleto(req.params.id))
}))

/* ------------------------------- Devoluciones ------------------------------- */

router.get('/devoluciones', requireCan(['Devoluciones', 'Consultar']), wrap(async (req, res) => {
  const where = []
  const params = []
  if (req.query.estado) {
    params.push(req.query.estado)
    where.push(`d.estado = $${params.length}`)
  }
  if (req.query.id_pedido) {
    params.push(req.query.id_pedido)
    where.push(`d.id_pedido = $${params.length}`)
  }
  res.json(await query(`${DEVOLUCION_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.id_detalle_devolucion DESC`, params))
}))

// Pedidos entregados con unidades por devolver (para el formulario de "Registrar devolución").
router.get('/devoluciones/elegibles', requireCan(['Devoluciones', 'Crear']), wrap(async (_req, res) => {
  res.json(await query(
    `SELECT * FROM (
       SELECT p.id_pedido,
              p.fecha_pedido,
              TRIM(CONCAT_WS(' ', c.primer_nombre, c.primer_apellido)) AS cliente,
              d.id_producto,
              pr.nombre AS producto,
              d.cantidad AS vendida,
              (d.cantidad - COALESCE((
                SELECT SUM(x.cantidad)
                FROM detalle_devolucion x
                WHERE x.id_pedido = d.id_pedido
                  AND x.id_producto = d.id_producto
                  AND x.estado <> 'Rechazada'
              ), 0))::int AS devolvible
       FROM pedido p
       JOIN cliente c ON c.id_cliente = p.id_cliente
       JOIN detalle_pedido d ON d.id_pedido = p.id_pedido
       JOIN producto pr ON pr.id_producto = d.id_producto
       WHERE p.id_estado_pedido = 3
     ) sub
     WHERE devolvible > 0
     ORDER BY id_pedido DESC, producto`
  ))
}))

router.get('/devoluciones/:id', requireCan(['Devoluciones', 'Consultar']), wrap(async (req, res) => {
  const rows = await query(`${DEVOLUCION_SELECT} WHERE d.id_detalle_devolucion = $1`, [req.params.id])
  if (!rows[0]) throw bad('La devolución no existe.')
  res.json(rows[0])
}))

// Body: { id_pedido, id_producto, cantidad, motivo }  → nace en estado Pendiente
router.post('/devoluciones', requireCan(['Devoluciones', 'Crear']), wrap(async (req, res) => {
  const b = req.body
  const id = await tx((conn) => svc.crearDevolucion(conn, { id_pedido: num(b.id_pedido), id_producto: num(b.id_producto), cantidad: num(b.cantidad), motivo: b.motivo }))
  res.status(201).json((await query(`${DEVOLUCION_SELECT} WHERE d.id_detalle_devolucion = $1`, [id]))[0])
}))

// Body: { estado: 'Pendiente' | 'En proceso' | 'Finalizada' | 'Rechazada' }
router.patch('/devoluciones/:id/estado', requireCan(['Devoluciones', 'Cambiar estado']), wrap(async (req, res) => {
  if (!ESTADOS_DEVOLUCION.includes(req.body.estado)) throw bad(`Estado no válido. Usa: ${ESTADOS_DEVOLUCION.join(', ')}.`)
  await tx((conn) => svc.cambiarEstadoDevolucion(conn, Number(req.params.id), req.body.estado))
  res.json((await query(`${DEVOLUCION_SELECT} WHERE d.id_detalle_devolucion = $1`, [req.params.id]))[0])
}))