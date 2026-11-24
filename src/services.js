// Reglas de negocio que mueven el stock. Cada función corre dentro de una transacción (client)
// y bloquea las filas de producto (FOR UPDATE) para que dos operaciones no se pisen.
import { config } from './config.js'
import { ESTADO } from './permissions.js'
import { bad, iva, mergeLines, notFound, text } from './util.js'

async function lockProducts(client, ids) {
  if (!ids.length) return new Map()
  const uniqueIds = [...new Set(ids)]
  const { rows } = await client.query(
    'SELECT * FROM producto WHERE id_producto = ANY($1::int[]) ORDER BY id_producto FOR UPDATE',
    [uniqueIds],
  )
  return new Map(rows.map((p) => [p.id_producto, p]))
}

const adjust = (client, id, delta) =>
  client.query(
    'UPDATE producto SET existencia_actual = existencia_actual + $1 WHERE id_producto = $2',
    [delta, id],
  )

/* ------------------------------ Pedidos ------------------------------ */

// Descuenta del stock; el precio SIEMPRE sale de producto.precio_venta (no se confía en el cliente).
async function salidaPedido(client, items) {
  const prods = await lockProducts(client, items.map((i) => i.id_producto))
  const lines = items.map((i) => {
    const p = prods.get(i.id_producto)
    if (!p) throw bad('Hay un producto que no existe.')
    if (p.estado !== 'Activo') throw bad(`${p.nombre} está inactivo y no se puede vender.`)
    if (p.existencia_actual < i.cantidad) {
      throw bad(`Stock insuficiente de ${p.nombre}: quedan ${p.existencia_actual} unidades.`)
    }
    return { id_producto: p.id_producto, cantidad: i.cantidad, precio_unitario: p.precio_venta }
  })
  for (const l of lines) await adjust(client, l.id_producto, -l.cantidad)
  return lines
}

async function insertarDetallePedido(client, id_pedido, lines) {
  let total = 0
  for (const l of lines) {
    const ivaLinea = iva(l.cantidad, l.precio_unitario)
    total += ivaLinea
    await client.query(
      'INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario, iva_producto) VALUES ($1, $2, $3, $4, $5)',
      [id_pedido, l.id_producto, l.cantidad, l.precio_unitario, ivaLinea],
    )
  }
  await client.query('UPDATE pedido SET iva = $1 WHERE id_pedido = $2', [total, id_pedido])
}

async function validarClienteActivo(client, id_cliente) {
  const { rows } = await client.query('SELECT estado FROM cliente WHERE id_cliente = $1', [id_cliente])
  const c = rows[0]
  if (!c) throw bad('Selecciona un cliente.')
  if (c.estado !== 'Activo') throw bad('El cliente está inactivo.')
}

function datosPedido(data) {
  const direccion_envio = text(data.direccion_envio)
  const metodo_pago = text(data.metodo_pago)
  if (!direccion_envio) throw bad('La dirección de envío es obligatoria.')
  if (!metodo_pago) throw bad('Selecciona el método de pago.')
  return { direccion_envio, metodo_pago, items: mergeLines(data.items) }
}

export async function crearPedido(client, { id_cliente, id_usuario, ...data }) {
  const { direccion_envio, metodo_pago, items } = datosPedido(data)
  await validarClienteActivo(client, id_cliente)
  const lines = await salidaPedido(client, items)
  const { rows } = await client.query(
    `INSERT INTO pedido (id_estado_pedido, id_cliente, id_usuario, fecha_pedido, direccion_envio, metodo_pago, iva)
     VALUES ($1, $2, $3, NOW(), $4, $5, 0)
     RETURNING id_pedido`,
    [ESTADO.PENDIENTE, id_cliente, id_usuario ?? null, direccion_envio, metodo_pago],
  )
  const id_pedido = rows[0].id_pedido
  await insertarDetallePedido(client, id_pedido, lines)
  return id_pedido
}

export async function actualizarPedido(client, id_pedido, data) {
  const { rows } = await client.query('SELECT * FROM pedido WHERE id_pedido = $1 FOR UPDATE', [id_pedido])
  const pedido = rows[0]
  if (!pedido) throw notFound('El pedido no existe.')
  if (pedido.id_estado_pedido !== ESTADO.PENDIENTE) {
    throw bad('Solo se puede editar un pedido en estado Pendiente.')
  }
  const { direccion_envio, metodo_pago, items } = datosPedido(data)
  const id_cliente = data.id_cliente ?? pedido.id_cliente
  await validarClienteActivo(client, id_cliente)

  // Se libera el stock anterior y luego se valida/aplica el nuevo detalle
  const { rows: old } = await client.query(
    'SELECT id_producto, cantidad FROM detalle_pedido WHERE id_pedido = $1 ORDER BY id_producto',
    [id_pedido],
  )
  if (old.length) await lockProducts(client, old.map((o) => o.id_producto))
  for (const o of old) await adjust(client, o.id_producto, o.cantidad)
  await client.query('DELETE FROM detalle_pedido WHERE id_pedido = $1', [id_pedido])

  const lines = await salidaPedido(client, items)
  await client.query(
    'UPDATE pedido SET id_cliente = $1, direccion_envio = $2, metodo_pago = $3 WHERE id_pedido = $4',
    [id_cliente, direccion_envio, metodo_pago, id_pedido],
  )
  await insertarDetallePedido(client, id_pedido, lines)
}

const TRANSICIONES = {
  [ESTADO.PENDIENTE]: [ESTADO.EN_PROCESO, ESTADO.CANCELADO],
  [ESTADO.EN_PROCESO]: [ESTADO.ENTREGADO, ESTADO.CANCELADO],
  [ESTADO.ENTREGADO]: [],
  [ESTADO.CANCELADO]: [],
}

export async function cambiarEstadoPedido(client, id_pedido, nuevo, { soloCliente } = {}) {
  const { rows } = await client.query('SELECT * FROM pedido WHERE id_pedido = $1 FOR UPDATE', [id_pedido])
  const pedido = rows[0]
  if (!pedido || (soloCliente && pedido.id_cliente !== soloCliente)) {
    throw notFound('El pedido no existe.')
  }
  if (!TRANSICIONES[pedido.id_estado_pedido]?.includes(nuevo)) {
    throw bad('Ese cambio de estado no está permitido para el pedido.')
  }
  if (nuevo === ESTADO.CANCELADO) {
    const { rows: det } = await client.query(
      'SELECT id_producto, cantidad FROM detalle_pedido WHERE id_pedido = $1 ORDER BY id_producto',
      [id_pedido],
    )
    if (det.length) await lockProducts(client, det.map((d) => d.id_producto))
    for (const d of det) await adjust(client, d.id_producto, d.cantidad) // revierte el stock
  }
  await client.query(
    'UPDATE pedido SET id_estado_pedido = $1, fecha_entrega = $2 WHERE id_pedido = $3',
    [nuevo, nuevo === ESTADO.ENTREGADO ? new Date() : pedido.fecha_entrega, id_pedido],
  )
}

/* ------------------------------ Compras ------------------------------ */

async function datosCompra(client, data) {
  const items = mergeLines(data.items)
  if (items.some((i) => i.precio_unitario === undefined)) {
    throw bad('Cada ítem de la compra necesita su precio unitario.')
  }
  const fecha = new Date(data.fecha_compra?.length === 10 ? `${data.fecha_compra}T12:00:00` : data.fecha_compra)
  if (Number.isNaN(fecha.getTime())) throw bad('La fecha de compra es obligatoria.')
  const { rows } = await client.query('SELECT estado FROM proveedor WHERE id_proveedor = $1', [data.id_proveedor])
  const prov = rows[0]
  if (!prov) throw bad('Selecciona un proveedor.')
  if (prov.estado !== 'Activo') throw bad('El proveedor está inactivo.')
  return { items, fecha }
}

async function entradaCompra(client, id_compra, items) {
  const prods = await lockProducts(client, items.map((i) => i.id_producto))
  let total = 0
  for (const i of items) {
    if (!prods.has(i.id_producto)) throw bad('Hay un producto que no existe.')
    const ivaLinea = iva(i.cantidad, i.precio_unitario)
    total += ivaLinea
    await adjust(client, i.id_producto, i.cantidad)
    // El último precio de compra queda como precio de compra del producto.
    await client.query('UPDATE producto SET precio_compra = $1 WHERE id_producto = $2', [i.precio_unitario, i.id_producto])
    await client.query(
      'INSERT INTO compra_producto (id_compra, id_producto, cantidad, precio_unitario, iva_producto) VALUES ($1, $2, $3, $4, $5)',
      [id_compra, i.id_producto, i.cantidad, i.precio_unitario, ivaLinea],
    )
  }
  await client.query('UPDATE compra SET iva = $1 WHERE id_compra = $2', [total, id_compra])
}

async function revertirCompra(client, id_compra) {
  const { rows: det } = await client.query(
    'SELECT id_producto, cantidad FROM compra_producto WHERE id_compra = $1 ORDER BY id_producto',
    [id_compra],
  )
  if (!det.length) return
  const prods = await lockProducts(client, det.map((d) => d.id_producto))
  for (const d of det) {
    const p = prods.get(d.id_producto)
    if (p.existencia_actual < d.cantidad) {
      throw bad(`No se puede revertir: ${p.nombre} ya tiene movimientos y solo quedan ${p.existencia_actual} unidades.`)
    }
  }
  for (const d of det) await adjust(client, d.id_producto, -d.cantidad)
}

export async function crearCompra(client, data) {
  const { items, fecha } = await datosCompra(client, data)
  const { rows } = await client.query(
    "INSERT INTO compra (id_proveedor, fecha_compra, iva, estado) VALUES ($1, $2, 0, 'Registrada') RETURNING id_compra",
    [data.id_proveedor, fecha],
  )
  const id_compra = rows[0].id_compra
  await entradaCompra(client, id_compra, items)
  return id_compra
}

export async function actualizarCompra(client, id_compra, data) {
  const { rows } = await client.query('SELECT * FROM compra WHERE id_compra = $1 FOR UPDATE', [id_compra])
  const compra = rows[0]
  if (!compra) throw notFound('La compra no existe.')
  if (compra.estado !== 'Registrada') throw bad('Una compra anulada no se puede editar.')
  const { items, fecha } = await datosCompra(client, data)
  await revertirCompra(client, id_compra)
  await client.query('DELETE FROM compra_producto WHERE id_compra = $1', [id_compra])
  await client.query(
    'UPDATE compra SET id_proveedor = $1, fecha_compra = $2 WHERE id_compra = $3',
    [data.id_proveedor, fecha, id_compra],
  )
  await entradaCompra(client, id_compra, items)
}

export async function anularCompra(client, id_compra) {
  const { rows } = await client.query('SELECT * FROM compra WHERE id_compra = $1 FOR UPDATE', [id_compra])
  const compra = rows[0]
  if (!compra) throw notFound('La compra no existe.')
  if (compra.estado === 'Anulada') throw bad('La compra ya está anulada.')
  await revertirCompra(client, id_compra)
  await client.query("UPDATE compra SET estado = 'Anulada' WHERE id_compra = $1", [id_compra])
}

/* ------------------------------ Devoluciones ------------------------------ */

const devueltas = async (client, id_pedido, id_producto, exceptId = 0) => {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(cantidad), 0) AS n
     FROM detalle_devolucion
     WHERE id_pedido = $1
       AND id_producto = $2
       AND estado <> 'Rechazada'
       AND id_detalle_devolucion <> $3`,
    [id_pedido, id_producto, exceptId],
  )
  return Number(rows[0].n)
}

export async function crearDevolucion(client, { id_pedido, id_producto, cantidad, motivo }, { soloCliente } = {}) {
  const { rows: pRows } = await client.query('SELECT * FROM pedido WHERE id_pedido = $1', [id_pedido])
  const pedido = pRows[0]
  if (!pedido || (soloCliente && pedido.id_cliente !== soloCliente)) throw bad('Selecciona un pedido.')
  if (pedido.id_estado_pedido !== ESTADO.ENTREGADO) {
    throw bad('Solo se pueden devolver productos de pedidos Entregados.')
  }
  const { rows: lRows } = await client.query(
    'SELECT * FROM detalle_pedido WHERE id_pedido = $1 AND id_producto = $2 FOR UPDATE',
    [id_pedido, id_producto],
  )
  const linea = lRows[0]
  if (!linea) throw bad('Selecciona un producto de ese pedido.')
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw bad('La cantidad debe ser un entero mayor a cero.')
  }
  const disponible = linea.cantidad - (await devueltas(client, id_pedido, id_producto))
  if (cantidad > disponible) {
    throw bad(`Solo se pueden devolver ${disponible} unidad(es) de este producto en el pedido.`)
  }
  if (!text(motivo)) throw bad('Escribe el motivo de la devolución.')
  const monto = Math.round(cantidad * linea.precio_unitario * (1 + config.ivaRate) * 100) / 100
  const { rows } = await client.query(
    `INSERT INTO detalle_devolucion (id_pedido, id_producto, fecha_devolucion, motivo, cantidad, monto_favor, estado)
     VALUES ($1, $2, NOW(), $3, $4, $5, 'Pendiente')
     RETURNING id_detalle_devolucion`,
    [id_pedido, id_producto, text(motivo).slice(0, 255), cantidad, monto],
  )
  return rows[0].id_detalle_devolucion
}

// Al pasar a Finalizada el producto vuelve al stock; si se sale de Finalizada, se descuenta de nuevo.
export async function cambiarEstadoDevolucion(client, id, estado) {
  const { rows } = await client.query(
    'SELECT * FROM detalle_devolucion WHERE id_detalle_devolucion = $1 FOR UPDATE',
    [id],
  )
  const dev = rows[0]
  if (!dev) throw notFound('La devolución no existe.')
  if (dev.estado === estado) return
  const prods = await lockProducts(client, [dev.id_producto])
  const producto = prods.get(dev.id_producto)

  if (dev.estado === 'Rechazada') {
    // al reabrir una devolución rechazada, la cantidad debe volver a caber en lo vendido
    const { rows: lRows } = await client.query(
      'SELECT cantidad FROM detalle_pedido WHERE id_pedido = $1 AND id_producto = $2',
      [dev.id_pedido, dev.id_producto],
    )
    const linea = lRows[0]
    if ((await devueltas(client, dev.id_pedido, dev.id_producto, id)) + dev.cantidad > linea.cantidad) {
      throw bad('No se puede reabrir: otras devoluciones ya cubren las unidades vendidas.')
    }
  }
  if (dev.estado === 'Finalizada') {
    if (producto.existencia_actual < dev.cantidad) {
      throw bad('No se puede cambiar el estado: las unidades reingresadas ya se vendieron.')
    }
    await adjust(client, dev.id_producto, -dev.cantidad)
  }
  if (estado === 'Finalizada') await adjust(client, dev.id_producto, dev.cantidad)
  await client.query(
    'UPDATE detalle_devolucion SET estado = $1 WHERE id_detalle_devolucion = $2',
    [estado, id],
  )
}