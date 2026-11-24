// Datos base (roles, privilegios, permisos, estados y primer Administrador). Idempotente.
//   npm run seed        → datos base
//   npm run seed:demo   → además datos de demostración (productos, cliente, vendedor, compras)
import bcrypt from 'bcryptjs'
import { pool, tx } from '../src/db.js'
import { ESTADOS_PEDIDO, PERMISOS_VALIDOS, PRIVILEGIOS } from '../src/permissions.js'
import * as svc from '../src/services.js'
import { checkPassword } from '../src/util.js'

const demo = process.argv.includes('--demo')
const q = (sql, params = []) => pool.query(sql, params)

for (const [i, [nombre, descripcion]] of ESTADOS_PEDIDO.entries()) {
  await q(
    `INSERT INTO estado_pedido (id_estado_pedido, nombre_estado, descripcion)
     VALUES ($1, $2, $3)
     ON CONFLICT (id_estado_pedido) DO UPDATE
     SET nombre_estado = EXCLUDED.nombre_estado,
         descripcion = EXCLUDED.descripcion`,
    [i + 1, nombre, descripcion]
  )
}

for (const [nombre, descripcion] of PRIVILEGIOS) {
  const existe = await q(
    'SELECT id_privilegio FROM privilegio WHERE nombre_privilegio = $1',
    [nombre]
  )
  if (existe.rowCount === 0) {
    await q(
      'INSERT INTO privilegio (nombre_privilegio, descripcion) VALUES ($1, $2)',
      [nombre, descripcion]
    )
  } else {
    await q(
      'UPDATE privilegio SET descripcion = $1 WHERE nombre_privilegio = $2',
      [descripcion, nombre]
    )
  }
}

for (const modulo of Object.keys(PERMISOS_VALIDOS)) {
  const existe = await q(
    'SELECT id_permiso FROM permiso WHERE nombre_permiso = $1',
    [modulo]
  )
  if (existe.rowCount === 0) {
    await q('INSERT INTO permiso (nombre_permiso) VALUES ($1)', [modulo])
  }
}

await q(
  `INSERT INTO rol (id_rol, nombre, descripcion, estado)
   VALUES (1, 'Administrador', 'Gestiona todos los módulos', 'Activo')
   ON CONFLICT (id_rol) DO UPDATE
   SET nombre = EXCLUDED.nombre,
       descripcion = EXCLUDED.descripcion,
       estado = EXCLUDED.estado`
)

await q(
  `INSERT INTO rol (id_rol, nombre, descripcion, estado)
   VALUES (2, 'Vendedor', 'Atiende clientes, pedidos y devoluciones', 'Activo')
   ON CONFLICT (id_rol) DO UPDATE
   SET nombre = EXCLUDED.nombre,
       descripcion = EXCLUDED.descripcion,
       estado = EXCLUDED.estado`
)

const grant = async (rol, modulo, acciones) => {
  for (const accion of acciones) {
    await q(
      `INSERT INTO rol_permiso (id_rol, id_permiso, id_privilegio)
       SELECT $1, p.id_permiso, pr.id_privilegio
       FROM permiso p
       CROSS JOIN privilegio pr
       WHERE p.nombre_permiso = $2
         AND pr.nombre_privilegio = $3
       ON CONFLICT (id_rol, id_permiso, id_privilegio) DO NOTHING`,
      [rol, modulo, accion]
    )
  }
}

for (const [modulo, acciones] of Object.entries(PERMISOS_VALIDOS)) {
  await grant(1, modulo, acciones)
}

const rol2Count = await q('SELECT COUNT(*)::int AS n FROM rol_permiso WHERE id_rol = 2')
if (rol2Count.rows[0].n === 0) {
  await grant(2, 'Dashboard', ['Consultar'])
  await grant(2, 'Productos', ['Consultar'])
  await grant(2, 'Clientes', ['Consultar', 'Crear', 'Editar', 'Historial de compras'])
  await grant(2, 'Pedidos', ['Consultar', 'Crear', 'Editar', 'Cambiar estado'])
  await grant(2, 'Devoluciones', ['Consultar', 'Crear'])
}

const crearUsuario = async (id_rol, doc, nombre, apellido, correo, password) => {
  const msg = checkPassword(password)
  if (msg) throw new Error(`Contraseña de ${correo}: ${msg}`)

  const existe = await q('SELECT id_usuario FROM usuario WHERE correo = $1', [correo])
  if (existe.rowCount === 0) {
    await q(
      `INSERT INTO usuario (
         id_rol, tipo_documento, numero_documento,
         primer_nombre, primer_apellido, correo, password, estado
       )
       VALUES ($1, 'CC', $2, $3, $4, $5, $6, 'Activo')`,
      [id_rol, doc, nombre, apellido, correo, await bcrypt.hash(password, 10)]
    )
  }
}

const adminEmail = (process.env.ADMIN_EMAIL || 'admin@nexacore.co').toLowerCase()
await crearUsuario(
  1,
  '1037000001',
  'Administrador',
  'NexaCore',
  adminEmail,
  process.env.ADMIN_PASSWORD || 'Admin2026*'
)
console.log(`Datos base listos. Administrador: ${adminEmail}`)

// Las tablas usan SERIAL: tras insertar ids fijos (estados, roles) se ajustan las secuencias
// para que el siguiente INSERT sin id no choque con la llave primaria.
for (const [tabla, campo] of [['estado_pedido', 'id_estado_pedido'], ['rol', 'id_rol']]) {
  await q(`SELECT setval(pg_get_serial_sequence('${tabla}', '${campo}'), (SELECT COALESCE(MAX(${campo}), 1) FROM ${tabla}))`)
}

if (demo) {
  await crearUsuario(2, '1037000002', 'Carlos', 'Ríos', 'carlos@nexacore.co', 'Vendedor2026*')

  const existeCliente = await q('SELECT id_cliente FROM cliente WHERE correo = $1', ['cliente@nexacore.co'])
  if (existeCliente.rowCount === 0) {
    await q(
      `INSERT INTO cliente (
         tipo_documento, documento, primer_nombre, primer_apellido,
         correo, password, telefono, departamento, municipio, direccion, estado
       )
       VALUES ('CC', '1000000001', 'Laura', 'Gómez', 'cliente@nexacore.co', $1, '3001234567', 'Antioquia', 'Medellín', 'Carrera 43A # 10-35', 'Activo')`,
      [await bcrypt.hash('Cliente2026*', 10)]
    )
  }

  const existeProv = await q('SELECT id_proveedor FROM proveedor WHERE numero_documento = $1', ['900123456'])
  if (existeProv.rowCount === 0) {
    await q(
      `INSERT INTO proveedor (
         tipo_persona, tipo_documento, numero_documento, razon_social,
         telefono, correo, departamento, municipio, direccion, estado
       )
       VALUES ('Jurídica', 'NIT', '900123456', 'TecnoImport Medellín S.A.S.', '3014567890', 'ventas@tecnoimport.co', 'Antioquia', 'Medellín', 'Carrera 50 # 45-12', 'Activo')`
    )
  }

  for (const c of ['Audio', 'Cables', 'Cargadores', 'Energía', 'Periféricos']) {
    await q('INSERT INTO categoria (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [c])
  }
  const categoriasRes = await q('SELECT id_categoria, nombre FROM categoria')
  const cat = Object.fromEntries(categoriasRes.rows.map((c) => [c.nombre, c.id_categoria]))

  // [código, nombre, categoría, venta, compra, mín, máx, unidades de la compra inicial, imagen (public/Products del frontend), descripción]
  const productos = [
    ['7701020001', 'Audífonos inalámbricos NexaCore Pro', 'Audio', 289900, 190000, 5, 40, 24, 'Audifonos_inalambricos_NexaCore_Pro.png', 'Audífonos over-ear con Bluetooth 5.3 y cancelación de ruido.'],
    ['7701020002', 'Cargador rápido 20W USB-C', 'Cargadores', 49900, 28000, 15, 60, 12, 'Cargador_de_pared_USB_C_con_cable_USB_C.png', 'Carga rápida de 20W compatible con iPhone, Android y tablets.'],
    ['7701020003', 'Batería externa 10.000 mAh', 'Energía', 129900, 85000, 10, 50, 31, 'Bateria_externa_10000_mAh.png', 'Power bank compacto con salida USB-C y USB-A e indicador LED.'],
    ['7701020004', 'Mouse inalámbrico ergonómico', 'Periféricos', 79900, 48000, 10, 40, 40, 'Mouse_inalambrico_ergonomico.png', 'Mouse silencioso de 2.4 GHz con sensor de alta precisión.'],
    ['7701020005', 'Audífonos Bluetooth TWS', 'Audio', 119900, 72000, 10, 50, 5, 'Audifonos_Bluetooth_TWS.png', 'Audífonos true wireless con estuche de carga y micrófono integrado.'],
    ['7701020006', 'Cable USB-C a USB-C 1m', 'Cables', 19900, 6000, 25, 100, 18, 'Cable_USB_C_a_USB_C_1_m.png', 'Cable trenzado de 1 metro para carga y datos.'],
    ['7701020007', 'Cable Lightning 1m', 'Cables', 24900, 8000, 20, 100, 64, 'Cable_Lightning_1_m.png', 'Cable Lightning de 1 metro para iPhone y iPad.'],
    ['7701020008', 'Audífonos con cable jack 3.5mm', 'Audio', 19900, 7000, 15, 80, 48, 'Audifonos_con_cable_jack_3_5_mm.png', 'Audífonos con micrófono y control de volumen.'],
    ['7701020009', 'Teclado mecánico compacto', 'Periféricos', 219900, 140000, 8, 30, 15, 'Teclado_mecanico_compacto.png', 'Teclado mecánico 75% con retroiluminación, USB-C y Bluetooth.'],
    ['7701020010', 'Parlante Bluetooth portátil', 'Audio', 159900, 100000, 8, 30, 22, 'Parlante Bluetooth portatil.jpeg', 'Parlante portátil con sonido envolvente y resistencia al agua.'],
    ['7701020011', 'Batería externa 20.000 mAh', 'Energía', 189900, 125000, 6, 30, 9, 'Bateria_externa_20000_mAh.png', 'Power bank de alta capacidad con dos puertos de salida.'],
    ['7701020012', 'Cargador inalámbrico 15W', 'Cargadores', 69900, 40000, 10, 40, 0, 'Cargador_inalambrico_15W.png', 'Base de carga inalámbrica Qi de 15W.'],
    ['7701020013', 'Hub USB-C 6 en 1', 'Periféricos', 139900, 90000, 8, 30, 7, 'Hub USB-C 6 en 1.jpeg', 'Hub con HDMI 4K, USB 3.0 y lector de tarjetas.'],
    ['7701020014', 'Batería externa portátil', 'Energía', 99900, 60000, 5, 30, 0, 'Bateria_externa_portatil.png', 'Batería externa portátil compacta para cargar dispositivos móviles.'],
    ['7701020015', 'Audífonos de diadema inalámbricos', 'Audio', 149900, 95000, 5, 30, 0, 'Audifonos_de_diademas_inalambricos.png', 'Audífonos inalámbricos tipo diadema con micrófono integrado.'],
    ['7701020016', 'Audífonos inalámbricos TWS', 'Audio', 99900, 58000, 5, 30, 0, 'Audifonos_inalambricos_TWS.png', 'Audífonos true wireless con estuche de carga.'],
  ]

  const unidades = new Map()
  for (const [codigo, nombre, categoria, venta, compra, min, max, cantidad, imagen, descripcion] of productos) {
    let id = (await q('SELECT id_producto FROM producto WHERE codigo_barra = $1', [codigo])).rows[0]?.id_producto
    if (!id) {
      const r = await q(
        `INSERT INTO producto (
           id_categoria, codigo_barra, nombre, descripcion,
           stock_min, stock_max, existencia_actual, precio_compra, precio_venta, estado
         )
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, 'Activo')
         RETURNING id_producto`,
        [cat[categoria], codigo, nombre, descripcion, min, max, compra, venta]
      )
      id = r.rows[0].id_producto
      await q(
        `INSERT INTO galeria_fotos (id_producto, url_imagen, texto_alternativo, fecha_creacion)
         VALUES ($1, $2, $3, NOW())`,
        [id, `/Products/${encodeURI(imagen)}`, nombre]
      )
    }
    if (cantidad > 0) unidades.set(id, { cantidad, precio: compra })
  }

  const prov = (await q('SELECT id_proveedor FROM proveedor WHERE numero_documento = $1', ['900123456'])).rows[0].id_proveedor
  const comprasCount = await q('SELECT COUNT(*)::int AS n FROM compra')
  if (comprasCount.rows[0].n === 0) {
    // El stock solo entra con compras: compra inicial (+3 unidades que consumen los pedidos de ejemplo).
    await tx((client) =>
      svc.crearCompra(client, {
        id_proveedor: prov,
        fecha_compra: new Date().toISOString().slice(0, 10),
        items: [...unidades].map(([id_producto, u]) => ({ id_producto, cantidad: u.cantidad + 3, precio_unitario: u.precio })),
      })
    )
  }

  // Pedidos de ejemplo del cliente demo: uno Entregado, uno En proceso y uno Pendiente.
  const pedidosCount = await q('SELECT COUNT(*)::int AS n FROM pedido')
  if (pedidosCount.rows[0].n === 0) {
    const cliente = (await q('SELECT id_cliente, direccion, municipio FROM cliente WHERE correo = $1', ['cliente@nexacore.co'])).rows[0]
    const vendedor = (await q('SELECT id_usuario FROM usuario WHERE correo = $1', ['carlos@nexacore.co'])).rows[0]
    const ids = [...unidades.keys()]
    const ejemplos = [
      { metodo_pago: 'Nequi', items: [{ id_producto: ids[0], cantidad: 1 }, { id_producto: ids[5], cantidad: 2 }], estados: [2, 3] },
      { metodo_pago: 'PSE', items: [{ id_producto: ids[2], cantidad: 1 }], estados: [2] },
      { metodo_pago: 'Tarjeta de crédito', items: [{ id_producto: ids[3], cantidad: 1 }], estados: [] },
    ]
    for (const e of ejemplos) {
      await tx(async (client) => {
        const id = await svc.crearPedido(client, {
          id_cliente: cliente.id_cliente,
          id_usuario: vendedor.id_usuario,
          direccion_envio: `${cliente.direccion}, ${cliente.municipio}`,
          metodo_pago: e.metodo_pago,
          items: e.items,
        })
        for (const estado of e.estados) await svc.cambiarEstadoPedido(client, id, estado)
      })
    }
  }

  console.log('Datos de demostración listos: carlos@nexacore.co / Vendedor2026*, cliente@nexacore.co / Cliente2026*')
}

await pool.end()

