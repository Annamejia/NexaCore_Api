// Dashboard único: todos los números salen de las tablas (ventas = pedidos En proceso o Entregado).
import { Router } from 'express'
import { hasPerm, requireCan } from '../auth.js'
import { query } from '../db.js'
import { wrap } from '../util.js'

export const router = Router()
const VENTA = '(2,3)'
const mes = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const label = (d) => new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(d).replace('.', '')

// GET /api/dashboard?period=month|6m|all
router.get('/', requireCan(['Dashboard', 'Consultar']), wrap(async (req, res) => {
  const now = new Date()
  const period = ['month', '6m', 'all'].includes(req.query.period) ? req.query.period : '6m'
  const start = period === 'month'
    ? new Date(now.getFullYear(), now.getMonth(), 1)
    : period === '6m'
      ? new Date(now.getFullYear(), now.getMonth() - 5, 1)
      : new Date(2000, 0, 1)
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1)
  const inicioMesAnt = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const verCompras = hasPerm(req, 'Compras', 'Consultar')

  const ventasEntre = async (a, b) => {
    const rows = await query(
      `SELECT COALESCE(SUM(d.cantidad * d.precio_unitario), 0)::numeric AS v
       FROM pedido p
       JOIN detalle_pedido d ON d.id_pedido = p.id_pedido
       WHERE p.id_estado_pedido IN ${VENTA}
         AND p.fecha_pedido >= $1
         AND p.fecha_pedido < $2`,
      [a, b]
    )
    return Number(rows[0]?.v ?? 0)
  }

  const [ventasMes, ventasMesAnterior] = [
    await ventasEntre(inicioMes, new Date(now.getFullYear(), now.getMonth() + 1, 1)),
    await ventasEntre(inicioMesAnt, inicioMes),
  ]

  const activos = await query(
    'SELECT id_estado_pedido, COUNT(*)::int AS n FROM pedido WHERE id_estado_pedido IN (1, 2) GROUP BY id_estado_pedido'
  )

  const prodRows = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE estado = 'Activo')::int AS activos
     FROM producto`
  )
  const prod = prodRows[0] ?? { total: 0, activos: 0 }

  const alertas = await query(
    `SELECT id_producto, nombre, existencia_actual, stock_min,
            CASE WHEN existencia_actual <= 0 THEN 'Agotado' ELSE 'Stock bajo' END AS alerta_stock
     FROM producto
     WHERE estado = 'Activo' AND existencia_actual <= stock_min
     ORDER BY existencia_actual, nombre`
  )

  const estados = await query(
    `SELECT e.nombre_estado AS label, COUNT(p.id_pedido)::int AS value
     FROM estado_pedido e
     LEFT JOIN pedido p ON p.id_estado_pedido = e.id_estado_pedido AND p.fecha_pedido >= $1
     GROUP BY e.id_estado_pedido, e.nombre_estado
     ORDER BY e.id_estado_pedido`,
    [start]
  )

  const pagos = await query(
    `SELECT p.metodo_pago AS label, COALESCE(SUM(d.cantidad * d.precio_unitario), 0)::numeric AS value
     FROM pedido p
     JOIN detalle_pedido d ON d.id_pedido = p.id_pedido
     WHERE p.id_estado_pedido IN ${VENTA} AND p.fecha_pedido >= $1
     GROUP BY p.metodo_pago
     ORDER BY value DESC`,
    [start]
  )

  const top = await query(
    `SELECT pr.nombre, COALESCE(SUM(d.cantidad), 0)::int AS cant
     FROM pedido p
     JOIN detalle_pedido d ON d.id_pedido = p.id_pedido
     JOIN producto pr ON pr.id_producto = d.id_producto
     WHERE p.id_estado_pedido IN ${VENTA} AND p.fecha_pedido >= $1
     GROUP BY pr.id_producto, pr.nombre
     ORDER BY cant DESC
     LIMIT 5`,
    [start]
  )

  const ultimos = await query(
    `SELECT p.id_pedido, p.fecha_pedido, p.metodo_pago, e.nombre_estado AS estado,
            TRIM(CONCAT_WS(' ', c.primer_nombre, c.primer_apellido)) AS cliente,
            (COALESCE((SELECT SUM(cantidad * precio_unitario) FROM detalle_pedido x WHERE x.id_pedido = p.id_pedido), 0) + COALESCE(p.iva, 0))::numeric AS total
     FROM pedido p
     JOIN cliente c ON c.id_cliente = p.id_cliente
     JOIN estado_pedido e ON e.id_estado_pedido = p.id_estado_pedido
     ORDER BY p.id_pedido DESC
     LIMIT 5`
  )

  const out = {
    periodo: period,
    kpis: {
      ventas_mes: ventasMes,
      ventas_mes_anterior: ventasMesAnterior,
      pedidos_pendientes: Number(activos.find((a) => a.id_estado_pedido === 1)?.n ?? 0),
      pedidos_en_proceso: Number(activos.find((a) => a.id_estado_pedido === 2)?.n ?? 0),
      productos_activos: Number(prod.activos ?? 0),
      productos_total: Number(prod.total ?? 0),
      alertas_stock: alertas.length,
    },
    estados_pedidos: estados.map((r) => ({ ...r, value: Number(r.value) })),
    metodos_pago: pagos.map((r) => ({ ...r, value: Number(r.value) })),
    alertas_stock: alertas,
    top_productos: top.map((r) => ({ ...r, cant: Number(r.cant) })),
    ultimos_pedidos: ultimos.map((r) => ({ ...r, total: Number(r.total) })),
  }

  if (verCompras) {
    const meses = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1))
    const desde = meses[0]

    const v = await query(
      `SELECT TO_CHAR(p.fecha_pedido, 'YYYY-MM') AS m,
              COALESCE(SUM(d.cantidad * d.precio_unitario), 0)::numeric AS v
       FROM pedido p
       JOIN detalle_pedido d ON d.id_pedido = p.id_pedido
       WHERE p.id_estado_pedido IN ${VENTA} AND p.fecha_pedido >= $1
       GROUP BY m`,
      [desde]
    )

    const c = await query(
      `SELECT TO_CHAR(c.fecha_compra, 'YYYY-MM') AS m,
              COALESCE(SUM(d.cantidad * d.precio_unitario), 0)::numeric AS v
       FROM compra c
       JOIN compra_producto d ON d.id_compra = c.id_compra
       WHERE c.estado = 'Registrada' AND c.fecha_compra >= $1
       GROUP BY m`,
      [desde]
    )

    out.ventas_vs_compras = meses.map((d) => ({
      mes: label(d),
      ventas: Number(v.find((x) => x.m === mes(d))?.v ?? 0),
      compras: Number(c.find((x) => x.m === mes(d))?.v ?? 0),
    }))

    const rentRows = await query(
      `SELECT c.nombre,
              COALESCE(SUM(d.cantidad * d.precio_unitario), 0)::numeric AS ingresos,
              COALESCE(SUM(d.cantidad * pr.precio_compra), 0)::numeric AS costo
       FROM categoria c
       LEFT JOIN producto pr ON pr.id_categoria = c.id_categoria
       LEFT JOIN (
         SELECT dp.id_producto, dp.cantidad, dp.precio_unitario
         FROM detalle_pedido dp
         JOIN pedido p ON p.id_pedido = dp.id_pedido
         WHERE p.id_estado_pedido IN ${VENTA} AND p.fecha_pedido >= $1
       ) d ON d.id_producto = pr.id_producto
       GROUP BY c.id_categoria, c.nombre
       ORDER BY c.nombre`,
      [start]
    )

    out.rentabilidad_categoria = rentRows.map((r) => {
      const ingresos = Number(r.ingresos ?? 0)
      const costo = Number(r.costo ?? 0)
      const utilidad = ingresos - costo
      const margen = ingresos ? Number(((utilidad / ingresos) * 100).toFixed(1)) : 0
      return {
        ...r,
        ingresos,
        costo,
        utilidad,
        margen,
      }
    })
  }

  res.json(out)
}))