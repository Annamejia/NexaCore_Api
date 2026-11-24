import { one, query } from './db.js'
import { notFound } from './util.js'

export const PRODUCTO_SELECT = `
  SELECT p.*, c.nombre AS categoria,
    (SELECT g.url_imagen FROM galeria_fotos g WHERE g.id_producto = p.id_producto ORDER BY g.id_galeria_fotos LIMIT 1) AS foto_principal,
    CASE WHEN p.existencia_actual <= 0 THEN 'Agotado'
         WHEN p.existencia_actual <= p.stock_min THEN 'Stock bajo' ELSE 'Normal' END AS alerta_stock
  FROM producto p
  JOIN categoria c ON c.id_categoria = p.id_categoria`

export async function productoConFotos(id, soloActivo = false) {
  const p = await one(
    `${PRODUCTO_SELECT} WHERE p.id_producto = $1 ${soloActivo ? "AND p.estado = 'Activo'" : ''}`,
    [id]
  )
  if (!p) throw notFound('El producto no existe.')
  p.fotos = await query('SELECT * FROM galeria_fotos WHERE id_producto = $1 ORDER BY id_galeria_fotos', [id])
  return p
}

const nombreSql = (a) =>
  `TRIM(CONCAT_WS(' ', ${a}.primer_nombre, NULLIF(${a}.segundo_nombre, ''), ${a}.primer_apellido, NULLIF(${a}.segundo_apellido, '')))`
export { nombreSql }

export const PEDIDO_SELECT = `
  SELECT p.*, e.nombre_estado AS estado, ${nombreSql('c')} AS cliente, c.documento AS cliente_documento,
         ${nombreSql('u')} AS atendido_por,
         COALESCE(t.subtotal, 0) AS subtotal, COALESCE(t.unidades, 0) AS unidades,
         COALESCE(t.subtotal, 0) + COALESCE(p.iva, 0) AS total
    FROM pedido p
    JOIN estado_pedido e ON e.id_estado_pedido = p.id_estado_pedido
    JOIN cliente c ON c.id_cliente = p.id_cliente
    LEFT JOIN usuario u ON u.id_usuario = p.id_usuario
    LEFT JOIN (
      SELECT id_pedido, SUM(cantidad * precio_unitario) AS subtotal, SUM(cantidad)::int AS unidades
      FROM detalle_pedido
      GROUP BY id_pedido
    ) t ON t.id_pedido = p.id_pedido`

export async function pedidoCompleto(id, id_cliente = null) {
  const p = await one(
    `${PEDIDO_SELECT} WHERE p.id_pedido = $1 ${id_cliente ? 'AND p.id_cliente = $2' : ''}`,
    id_cliente ? [id, id_cliente] : [id]
  )
  if (!p) throw notFound('El pedido no existe.')
  p.items = await query(
    `SELECT d.*, pr.nombre AS producto, d.cantidad * d.precio_unitario AS subtotal,
            (SELECT g.url_imagen FROM galeria_fotos g WHERE g.id_producto = d.id_producto ORDER BY g.id_galeria_fotos LIMIT 1) AS foto_principal
       FROM detalle_pedido d
       JOIN producto pr ON pr.id_producto = d.id_producto
      WHERE d.id_pedido = $1
      ORDER BY pr.nombre`,
    [id]
  )
  return p
}

export const COMPRA_SELECT = `
  SELECT c.*, pv.razon_social AS proveedor, pv.numero_documento AS proveedor_documento,
         COALESCE(t.subtotal, 0) AS subtotal, COALESCE(t.unidades, 0) AS unidades,
         COALESCE(t.subtotal, 0) + COALESCE(c.iva, 0) AS total
    FROM compra c
    JOIN proveedor pv ON pv.id_proveedor = c.id_proveedor
    LEFT JOIN (
      SELECT id_compra, SUM(cantidad * precio_unitario) AS subtotal, SUM(cantidad)::int AS unidades
      FROM compra_producto
      GROUP BY id_compra
    ) t ON t.id_compra = c.id_compra`

export async function compraCompleta(id) {
  const c = await one(`${COMPRA_SELECT} WHERE c.id_compra = $1`, [id])
  if (!c) throw notFound('La compra no existe.')
  c.items = await query(
    `SELECT d.*, pr.nombre AS producto, d.cantidad * d.precio_unitario AS subtotal
       FROM compra_producto d
       JOIN producto pr ON pr.id_producto = d.id_producto
      WHERE d.id_compra = $1
      ORDER BY pr.nombre`,
    [id]
  )
  return c
}

export const DEVOLUCION_SELECT = `
  SELECT d.*, p.id_cliente, ${nombreSql('c')} AS cliente, pr.nombre AS producto
    FROM detalle_devolucion d
    JOIN pedido p ON p.id_pedido = d.id_pedido
    JOIN cliente c ON c.id_cliente = p.id_cliente
    JOIN producto pr ON pr.id_producto = d.id_producto`

export const sinPassword = ({ password: _p, ...rest }) => rest