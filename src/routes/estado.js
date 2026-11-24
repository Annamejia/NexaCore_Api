// GET /api/estado → las tablas que la sesión actual puede ver, con la misma forma del script de la BD.
// El frontend arma sus pantallas con estas tablas; todo cambio pasa por los endpoints REST de cada módulo.
//   - Sin sesión: catálogo público (categorías, productos activos sin datos internos, fotos, estados).
//   - Cliente: lo público + su cuenta, sus pedidos, sus detalles y sus devoluciones.
//   - Personal: cada tabla según los permisos de su rol (nunca se envían contraseñas).
import jwt from 'jsonwebtoken'
import { Router } from 'express'
import { permisosDe } from '../auth.js'
import { config } from '../config.js'
import { one, query } from '../db.js'
import { wrap } from '../util.js'

export const router = Router()

const CLIENTE_COLS = 'id_cliente, tipo_documento, documento, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, correo, telefono, departamento, municipio, direccion, estado'
const USUARIO_COLS = 'id_usuario, id_rol, tipo_documento, numero_documento, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, correo, estado'
const PRODUCTO_PUBLICO = 'id_producto, id_categoria, nombre, descripcion, stock_min, existencia_actual, precio_venta, estado'

function leerSesion(req) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return null
  try {
    return jwt.verify(header.slice(7), config.jwtSecret)
  } catch {
    return null
  }
}

router.get('/', wrap(async (req, res) => {
  const auth = leerSesion(req)
  let kind = null
  let perms = new Set()

  if (auth?.kind === 'cliente') {
    if (await one("SELECT 1 FROM cliente WHERE id_cliente = $1 AND estado = 'Activo'", [auth.id])) kind = 'cliente'
  } else if (auth?.kind === 'staff') {
    perms = await permisosDe(auth.id) // vacío si el usuario o su rol están inactivos
    if (await one("SELECT 1 FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.id_usuario = $1 AND u.estado = 'Activo' AND r.estado = 'Activo'", [auth.id])) kind = 'staff'
  }
  const can = (...pares) => pares.some(([m, p]) => perms.has(`${m}|${p}`))
  const staff = kind === 'staff'

  const out = {
    kind,
    iva: config.ivaRate,
    categoria: await query('SELECT * FROM categoria ORDER BY id_categoria'),
    estado_pedido: await query('SELECT * FROM estado_pedido ORDER BY id_estado_pedido'),
    producto: [],
    galeria_fotos: [],
    cliente: [],
    pedido: [],
    detalle_pedido: [],
    detalle_devolucion: [],
    proveedor: [],
    compra: [],
    compra_producto: [],
    usuario: [],
    rol: [],
    permiso: [],
    privilegio: [],
    rol_permiso: [],
  }

  const verInventario = staff && can(['Productos', 'Consultar'], ['Compras', 'Consultar'], ['Compras', 'Crear'])
  if (verInventario) {
    out.producto = await query('SELECT * FROM producto ORDER BY id_producto')
  } else {
    // Público: productos activos y, para el cliente o el personal, también los que aparecen en sus pedidos.
    out.producto = await query(
      `SELECT ${PRODUCTO_PUBLICO} FROM producto p
        WHERE p.estado = 'Activo'
           OR ($1::int IS NOT NULL AND EXISTS (
                SELECT 1 FROM detalle_pedido d JOIN pedido pe ON pe.id_pedido = d.id_pedido
                 WHERE d.id_producto = p.id_producto AND pe.id_cliente = $1))
           OR $2::boolean
        ORDER BY id_producto`,
      [kind === 'cliente' ? auth.id : null, staff]
    )
  }
  const idsProductos = out.producto.map((p) => p.id_producto)
  out.galeria_fotos = await query('SELECT * FROM galeria_fotos WHERE id_producto = ANY($1::int[]) ORDER BY id_galeria_fotos', [idsProductos])

  if (kind === 'cliente') {
    out.cliente = await query(`SELECT ${CLIENTE_COLS} FROM cliente WHERE id_cliente = $1`, [auth.id])
    out.pedido = await query('SELECT * FROM pedido WHERE id_cliente = $1 ORDER BY id_pedido', [auth.id])
    out.detalle_pedido = await query(
      'SELECT d.* FROM detalle_pedido d JOIN pedido p ON p.id_pedido = d.id_pedido WHERE p.id_cliente = $1',
      [auth.id]
    )
    out.detalle_devolucion = await query(
      'SELECT d.* FROM detalle_devolucion d JOIN pedido p ON p.id_pedido = d.id_pedido WHERE p.id_cliente = $1 ORDER BY d.id_detalle_devolucion',
      [auth.id]
    )
  }

  if (staff) {
    const verPedidos = can(['Pedidos', 'Consultar'], ['Dashboard', 'Consultar'], ['Clientes', 'Historial de compras'], ['Devoluciones', 'Consultar'])
    if (verPedidos) {
      out.pedido = await query('SELECT * FROM pedido ORDER BY id_pedido')
      out.detalle_pedido = await query('SELECT * FROM detalle_pedido')
    }
    if (verPedidos || can(['Clientes', 'Consultar'], ['Pedidos', 'Crear'])) {
      out.cliente = await query(`SELECT ${CLIENTE_COLS} FROM cliente ORDER BY id_cliente`)
    }
    if (can(['Devoluciones', 'Consultar'], ['Dashboard', 'Consultar'], ['Pedidos', 'Consultar'])) {
      out.detalle_devolucion = await query('SELECT * FROM detalle_devolucion ORDER BY id_detalle_devolucion')
    }
    if (can(['Proveedores', 'Consultar'], ['Compras', 'Consultar'], ['Compras', 'Crear'])) {
      out.proveedor = await query('SELECT * FROM proveedor ORDER BY id_proveedor')
    }
    if (can(['Compras', 'Consultar'])) {
      out.compra = await query('SELECT * FROM compra ORDER BY id_compra')
      out.compra_producto = await query('SELECT * FROM compra_producto')
    }
    // Nombres del personal (responsables de pedidos) y la estructura de roles/permisos que arma el menú.
    out.usuario = await query(`SELECT ${USUARIO_COLS} FROM usuario ORDER BY id_usuario`)
    out.rol = await query('SELECT * FROM rol ORDER BY id_rol')
    out.permiso = await query('SELECT * FROM permiso ORDER BY id_permiso')
    out.privilegio = await query('SELECT * FROM privilegio ORDER BY id_privilegio')
    out.rol_permiso = await query('SELECT * FROM rol_permiso')
  }

  res.json(out)
}))
