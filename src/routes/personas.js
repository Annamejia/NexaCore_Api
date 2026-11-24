// Proveedores, Clientes, Usuarios y Roles (cada uno con los campos de su tabla).
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { requireCan } from '../auth.js'
import { one, pool, query, tx } from '../db.js'
import { PERMISOS_VALIDOS } from '../permissions.js'
import { nombreSql, PEDIDO_SELECT } from '../queries.js'
import { bad, checkPassword, conflict, EMAIL_RE, need, notFound, num, text, wrap } from '../util.js'

export const router = Router()
const ESTADOS = ['Activo', 'Inactivo']
const estadoValido = (e) => {
  if (!ESTADOS.includes(e)) throw bad('Estado no válido.')
  return e
}
const idParam = (v) => {
  const n = num(v)
  if (!Number.isInteger(n) || n <= 0) throw bad('Identificador no válido.')
  return n
}

/* ------------------------------- Proveedores ------------------------------- */

function datosProveedor(b) {
  need(b, [['razon_social', 'razón social'], ['numero_documento', 'número de documento'], ['correo', 'correo']])
  if (!EMAIL_RE.test(text(b.correo))) throw bad('Ingresa un correo válido.')
  return [
    text(b.tipo_persona) || 'Jurídica',
    text(b.tipo_documento) || 'NIT',
    text(b.numero_documento),
    text(b.razon_social),
    text(b.telefono),
    text(b.correo),
    text(b.departamento),
    text(b.municipio),
    text(b.direccion),
  ]
}

router.get(
  '/proveedores',
  requireCan(['Proveedores', 'Consultar'], ['Compras', 'Crear'], ['Compras', 'Editar']),
  wrap(async (req, res) => {
    const where = []
    const params = []
    if (req.query.estado) {
      params.push(req.query.estado)
      where.push(`estado = $${params.length}`)
    }
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      const p = `$${params.length}`
      where.push(`(razon_social ILIKE ${p} OR numero_documento::text ILIKE ${p} OR correo ILIKE ${p})`)
    }
    res.json(await query(`SELECT * FROM proveedor ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY razon_social`, params))
  })
)

router.get(
  '/proveedores/:id',
  requireCan(['Proveedores', 'Consultar']),
  wrap(async (req, res) => {
    const row = await one('SELECT * FROM proveedor WHERE id_proveedor = $1', [idParam(req.params.id)])
    if (!row) throw notFound('El proveedor no existe.')
    res.json(row)
  })
)

router.post(
  '/proveedores',
  requireCan(['Proveedores', 'Crear']),
  wrap(async (req, res) => {
    const d = datosProveedor(req.body)
    const estado = estadoValido(text(req.body.estado) || 'Activo')
    const r = await pool.query(
      `INSERT INTO proveedor (
         tipo_persona, tipo_documento, numero_documento, razon_social,
         telefono, correo, departamento, municipio, direccion, estado
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id_proveedor`,
      [...d, estado]
    )
    res.status(201).json(await one('SELECT * FROM proveedor WHERE id_proveedor = $1', [r.rows[0].id_proveedor]))
  })
)

router.put(
  '/proveedores/:id',
  requireCan(['Proveedores', 'Editar']),
  wrap(async (req, res) => {
    const id = idParam(req.params.id)
    const d = datosProveedor(req.body)
    const estado = estadoValido(text(req.body.estado) || 'Activo')
    const r = await pool.query(
      `UPDATE proveedor
       SET tipo_persona = $1, tipo_documento = $2, numero_documento = $3, razon_social = $4,
           telefono = $5, correo = $6, departamento = $7, municipio = $8, direccion = $9, estado = $10
       WHERE id_proveedor = $11`,
      [...d, estado, id]
    )
    if (!r.rowCount) throw notFound('El proveedor no existe.')
    res.json(await one('SELECT * FROM proveedor WHERE id_proveedor = $1', [id]))
  })
)

router.patch(
  '/proveedores/:id/estado',
  requireCan(['Proveedores', 'Cambiar estado']),
  wrap(async (req, res) => {
    const id = idParam(req.params.id)
    const r = await pool.query(
      'UPDATE proveedor SET estado = $1 WHERE id_proveedor = $2',
      [estadoValido(req.body.estado), id]
    )
    if (!r.rowCount) throw notFound('El proveedor no existe.')
    res.json(await one('SELECT * FROM proveedor WHERE id_proveedor = $1', [id]))
  })
)

/* ------------------------------- Clientes ------------------------------- */

const emailLibre = async (correo, { cliente = 0, usuario = 0 } = {}) => {
  if (await one('SELECT 1 FROM cliente WHERE correo = $1 AND id_cliente <> $2', [correo, cliente])) {
    throw conflict('Ya existe un cliente con ese correo.')
  }
  if (await one('SELECT 1 FROM usuario WHERE correo = $1 AND id_usuario <> $2', [correo, usuario])) {
    throw conflict('Ese correo ya pertenece a un usuario del sistema.')
  }
}

function datosCliente(b) {
  need(b, [['documento', 'documento'], ['primer_nombre', 'primer nombre'], ['primer_apellido', 'primer apellido'], ['correo', 'correo']])
  if (!EMAIL_RE.test(text(b.correo))) throw bad('Ingresa un correo válido.')
  return {
    tipo_documento: text(b.tipo_documento) || 'CC',
    documento: text(b.documento),
    primer_nombre: text(b.primer_nombre),
    segundo_nombre: text(b.segundo_nombre),
    primer_apellido: text(b.primer_apellido),
    segundo_apellido: text(b.segundo_apellido),
    correo: text(b.correo).toLowerCase(),
    telefono: text(b.telefono),
    departamento: text(b.departamento),
    municipio: text(b.municipio),
    direccion: text(b.direccion),
    estado: estadoValido(text(b.estado) || 'Activo'),
  }
}

const CLIENTE_COLS = 'id_cliente, tipo_documento, documento, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, correo, telefono, departamento, municipio, direccion, estado'

router.get(
  '/clientes',
  requireCan(['Clientes', 'Consultar'], ['Pedidos', 'Crear'], ['Pedidos', 'Editar']),
  wrap(async (req, res) => {
    const where = []
    const params = []
    if (req.query.estado) {
      params.push(req.query.estado)
      where.push(`estado = $${params.length}`)
    }
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      const p = `$${params.length}`
      where.push(`(${nombreSql('cliente')} ILIKE ${p} OR documento ILIKE ${p} OR correo ILIKE ${p})`)
    }
    res.json(await query(`SELECT ${CLIENTE_COLS} FROM cliente ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY primer_nombre, primer_apellido`, params))
  })
)

router.get(
  '/clientes/:id',
  requireCan(['Clientes', 'Consultar']),
  wrap(async (req, res) => {
    const row = await one(`SELECT ${CLIENTE_COLS} FROM cliente WHERE id_cliente = $1`, [idParam(req.params.id)])
    if (!row) throw notFound('El cliente no existe.')
    res.json(row)
  })
)

router.post(
  '/clientes',
  requireCan(['Clientes', 'Crear']),
  wrap(async (req, res) => {
    const d = datosCliente(req.body)
    const msg = checkPassword(req.body.password)
    if (msg) throw bad(msg)
    await emailLibre(d.correo)
    const hash = await bcrypt.hash(req.body.password, 10)
    const r = await pool.query(
      `INSERT INTO cliente (
         tipo_documento, documento, primer_nombre, segundo_nombre,
         primer_apellido, segundo_apellido, correo, password,
         telefono, departamento, municipio, direccion, estado
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id_cliente`,
      [
        d.tipo_documento, d.documento, d.primer_nombre, d.segundo_nombre,
        d.primer_apellido, d.segundo_apellido, d.correo, hash,
        d.telefono, d.departamento, d.municipio, d.direccion, d.estado,
      ]
    )
    res.status(201).json(await one(`SELECT ${CLIENTE_COLS} FROM cliente WHERE id_cliente = $1`, [r.rows[0].id_cliente]))
  })
)

router.put(
  '/clientes/:id',
  requireCan(['Clientes', 'Editar']),
  wrap(async (req, res) => {
    const id = idParam(req.params.id)
    const d = datosCliente(req.body)
    await emailLibre(d.correo, { cliente: id })

    const campos = [
      'tipo_documento = $1', 'documento = $2', 'primer_nombre = $3', 'segundo_nombre = $4',
      'primer_apellido = $5', 'segundo_apellido = $6', 'correo = $7', 'telefono = $8',
      'departamento = $9', 'municipio = $10', 'direccion = $11', 'estado = $12',
    ]
    const valores = [
      d.tipo_documento, d.documento, d.primer_nombre, d.segundo_nombre,
      d.primer_apellido, d.segundo_apellido, d.correo, d.telefono,
      d.departamento, d.municipio, d.direccion, d.estado,
    ]

    if (req.body.password) {
      const msg = checkPassword(req.body.password)
      if (msg) throw bad(msg)
      valores.push(await bcrypt.hash(req.body.password, 10))
      campos.push(`password = $${valores.length}`)
    }

    valores.push(id)
    const r = await pool.query(
      `UPDATE cliente SET ${campos.join(', ')} WHERE id_cliente = $${valores.length}`,
      valores
    )
    if (!r.rowCount) throw notFound('El cliente no existe.')
    res.json(await one(`SELECT ${CLIENTE_COLS} FROM cliente WHERE id_cliente = $1`, [id]))
  })
)

router.patch(
  '/clientes/:id/estado',
  requireCan(['Clientes', 'Cambiar estado']),
  wrap(async (req, res) => {
    const id = idParam(req.params.id)
    const r = await pool.query(
      'UPDATE cliente SET estado = $1 WHERE id_cliente = $2',
      [estadoValido(req.body.estado), id]
    )
    if (!r.rowCount) throw notFound('El cliente no existe.')
    res.json(await one(`SELECT ${CLIENTE_COLS} FROM cliente WHERE id_cliente = $1`, [id]))
  })
)

// Historial de compras: es un PRIVILEGIO de Clientes.
router.get(
  '/clientes/:id/pedidos',
  requireCan(['Clientes', 'Historial de compras']),
  wrap(async (req, res) => {
    res.json(await query(`${PEDIDO_SELECT} WHERE p.id_cliente = $1 ORDER BY p.id_pedido DESC`, [idParam(req.params.id)]))
  })
)

/* ------------------------------- Usuarios ------------------------------- */

const USUARIO_COLS = 'u.id_usuario, u.id_rol, r.nombre AS rol, u.tipo_documento, u.numero_documento, u.primer_nombre, u.segundo_nombre, u.primer_apellido, u.segundo_apellido, u.correo, u.estado'
const USUARIO_FROM = 'FROM usuario u JOIN rol r ON r.id_rol = u.id_rol'

async function datosUsuario(b) {
  need(b, [['numero_documento', 'documento'], ['primer_nombre', 'primer nombre'], ['primer_apellido', 'primer apellido'], ['correo', 'correo'], ['id_rol', 'rol']])
  if (!EMAIL_RE.test(text(b.correo))) throw bad('Ingresa un correo válido.')
  const rol = await one('SELECT id_rol FROM rol WHERE id_rol = $1', [b.id_rol])
  if (!rol) throw bad('Selecciona un rol de la lista.')
  return {
    id_rol: rol.id_rol,
    tipo_documento: text(b.tipo_documento) || 'CC',
    numero_documento: text(b.numero_documento),
    primer_nombre: text(b.primer_nombre),
    segundo_nombre: text(b.segundo_nombre),
    primer_apellido: text(b.primer_apellido),
    segundo_apellido: text(b.segundo_apellido),
    correo: text(b.correo).toLowerCase(),
    estado: estadoValido(text(b.estado) || 'Activo'),
  }
}

async function ultimoAdmin(id_usuario) {
  // Debe quedar al menos un Administrador activo.
  const u = await one('SELECT id_rol, estado FROM usuario WHERE id_usuario = $1', [id_usuario])
  if (!u || u.id_rol !== 1 || u.estado !== 'Activo') return false
  const n = await one("SELECT COUNT(*)::int AS n FROM usuario WHERE id_rol = 1 AND estado = 'Activo'")
  return Number(n?.n ?? 0) <= 1
}

router.get(
  '/usuarios',
  requireCan(['Usuarios', 'Consultar']),
  wrap(async (req, res) => {
    const where = []
    const params = []
    if (req.query.id_rol) {
      params.push(idParam(req.query.id_rol))
      where.push(`u.id_rol = $${params.length}`)
    }
    if (req.query.estado) {
      params.push(req.query.estado)
      where.push(`u.estado = $${params.length}`)
    }
    if (req.query.q) {
      params.push(`%${req.query.q}%`)
      const p = `$${params.length}`
      where.push(`(${nombreSql('u')} ILIKE ${p} OR u.numero_documento ILIKE ${p} OR u.correo ILIKE ${p})`)
    }
    res.json(await query(`SELECT ${USUARIO_COLS} ${USUARIO_FROM} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.primer_nombre`, params))
  })
)

router.get(
  '/usuarios/:id',
  requireCan(['Usuarios', 'Consultar']),
  wrap(async (req, res) => {
    const row = await one(`SELECT ${USUARIO_COLS} ${USUARIO_FROM} WHERE u.id_usuario = $1`, [idParam(req.params.id)])
    if (!row) throw notFound('El usuario no existe.')
    res.json(row)
  })
)

router.post(
  '/usuarios',
  requireCan(['Usuarios', 'Crear']),
  wrap(async (req, res) => {
    const d = await datosUsuario(req.body)
    const msg = checkPassword(req.body.password)
    if (msg) throw bad(msg)
    await emailLibre(d.correo)
    const hash = await bcrypt.hash(req.body.password, 10)
    const r = await pool.query(
      `INSERT INTO usuario (
         id_rol, tipo_documento, numero_documento,
         primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
         correo, password, estado
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id_usuario`,
      [
        d.id_rol, d.tipo_documento, d.numero_documento,
        d.primer_nombre, d.segundo_nombre, d.primer_apellido, d.segundo_apellido,
        d.correo, hash, d.estado,
      ]
    )
    res.status(201).json(await one(`SELECT ${USUARIO_COLS} ${USUARIO_FROM} WHERE u.id_usuario = $1`, [r.rows[0].id_usuario]))
  })
)

router.put(
  '/usuarios/:id',
  requireCan(['Usuarios', 'Editar']),
  wrap(async (req, res) => {
    const id = idParam(req.params.id)
    const d = await datosUsuario(req.body)
    await emailLibre(d.correo, { usuario: id })
    if ((d.estado === 'Inactivo' || d.id_rol !== 1) && (await ultimoAdmin(id))) {
      throw bad('Debe quedar al menos un Administrador activo.')
    }

    const campos = [
      'id_rol = $1', 'tipo_documento = $2', 'numero_documento = $3',
      'primer_nombre = $4', 'segundo_nombre = $5', 'primer_apellido = $6', 'segundo_apellido = $7',
      'correo = $8', 'estado = $9',
    ]
    const valores = [
      d.id_rol, d.tipo_documento, d.numero_documento,
      d.primer_nombre, d.segundo_nombre, d.primer_apellido, d.segundo_apellido,
      d.correo, d.estado,
    ]

    if (req.body.password) {
      const msg = checkPassword(req.body.password)
      if (msg) throw bad(msg)
      valores.push(await bcrypt.hash(req.body.password, 10))
      campos.push(`password = $${valores.length}`)
    }

    valores.push(id)
    const r = await pool.query(
      `UPDATE usuario SET ${campos.join(', ')} WHERE id_usuario = $${valores.length}`,
      valores
    )
    if (!r.rowCount) throw notFound('El usuario no existe.')
    res.json(await one(`SELECT ${USUARIO_COLS} ${USUARIO_FROM} WHERE u.id_usuario = $1`, [id]))
  })
)

router.patch(
  '/usuarios/:id/estado',
  requireCan(['Usuarios', 'Cambiar estado']),
  wrap(async (req, res) => {
    const id = idParam(req.params.id)
    const estado = estadoValido(req.body.estado)
    if (estado === 'Inactivo' && (await ultimoAdmin(id))) {
      throw bad('Debe quedar al menos un Administrador activo.')
    }
    const r = await pool.query(
      'UPDATE usuario SET estado = $1 WHERE id_usuario = $2',
      [estado, id]
    )
    if (!r.rowCount) throw notFound('El usuario no existe.')
    res.json(await one(`SELECT ${USUARIO_COLS} ${USUARIO_FROM} WHERE u.id_usuario = $1`, [id]))
  })
)

/* ------------------------------- Roles y permisos ------------------------------- */

// Catálogo de módulos × privilegios válidos (para dibujar la matriz de permisos).
router.get(
  '/permisos/catalogo',
  requireCan(['Roles', 'Consultar'], ['Roles', 'Crear'], ['Roles', 'Editar']),
  wrap(async (_req, res) => {
    res.json({ modulos: PERMISOS_VALIDOS, privilegios: await query('SELECT * FROM privilegio ORDER BY id_privilegio') })
  })
)

router.get(
  '/roles',
  requireCan(['Roles', 'Consultar'], ['Usuarios', 'Crear'], ['Usuarios', 'Editar']),
  wrap(async (_req, res) => {
    res.json(
      await query(
        `SELECT r.*,
                (SELECT COUNT(*)::int FROM usuario u WHERE u.id_rol = r.id_rol) AS usuarios,
                (SELECT COUNT(*)::int FROM rol_permiso rp WHERE rp.id_rol = r.id_rol) AS permisos
         FROM rol r
         ORDER BY r.id_rol`
      )
    )
  })
)

async function permisosDeRol(id_rol) {
  return query(
    `SELECT p.nombre_permiso AS modulo, pr.nombre_privilegio AS privilegio
     FROM rol_permiso rp
     JOIN permiso p ON p.id_permiso = rp.id_permiso
     JOIN privilegio pr ON pr.id_privilegio = rp.id_privilegio
     WHERE rp.id_rol = $1
     ORDER BY p.id_permiso, pr.id_privilegio`,
    [id_rol]
  )
}

router.get(
  '/roles/:id',
  requireCan(['Roles', 'Consultar']),
  wrap(async (req, res) => {
    const rol = await one('SELECT * FROM rol WHERE id_rol = $1', [idParam(req.params.id)])
    if (!rol) throw notFound('El rol no existe.')
    res.json({ ...rol, permisos: await permisosDeRol(rol.id_rol) })
  })
)

// Guarda solo combinaciones válidas módulo × privilegio; "Consultar" va implícito si hay otra acción.
async function guardarPermisos(conn, id_rol, pares) {
  if (id_rol === 1) throw bad('Los permisos del Administrador no se pueden modificar.')
  const set = new Set()
  for (const par of Array.isArray(pares) ? pares : []) {
    const [modulo, privilegio] = Array.isArray(par) ? par : [par?.modulo, par?.privilegio]
    if (!PERMISOS_VALIDOS[modulo]?.includes(privilegio)) throw bad(`Combinación no válida: ${modulo} × ${privilegio}.`)
    set.add(`${modulo}|${privilegio}`)
    set.add(`${modulo}|Consultar`)
  }
  await conn.query('DELETE FROM rol_permiso WHERE id_rol = $1', [id_rol])
  for (const k of set) {
    const [modulo, privilegio] = k.split('|')
    await conn.query(
      `INSERT INTO rol_permiso (id_rol, id_permiso, id_privilegio)
       SELECT $1, p.id_permiso, pr.id_privilegio
       FROM permiso p
       CROSS JOIN privilegio pr
       WHERE p.nombre_permiso = $2 AND pr.nombre_privilegio = $3`,
      [id_rol, modulo, privilegio]
    )
  }
}

router.post(
  '/roles',
  requireCan(['Roles', 'Crear']),
  wrap(async (req, res) => {
    need(req.body, [['nombre', 'nombre del rol']])
    const id = await tx(async (conn) => {
      const r = await conn.query(
        'INSERT INTO rol (nombre, descripcion, estado) VALUES ($1, $2, $3) RETURNING id_rol',
        [text(req.body.nombre), text(req.body.descripcion), 'Activo']
      )
      const nuevoId = r.rows[0].id_rol
      if (req.body.permisos) await guardarPermisos(conn, nuevoId, req.body.permisos)
      return nuevoId
    })
    res.status(201).json({ ...(await one('SELECT * FROM rol WHERE id_rol = $1', [id])), permisos: await permisosDeRol(id) })
  })
)

router.put(
  '/roles/:id',
  requireCan(['Roles', 'Editar']),
  wrap(async (req, res) => {
    need(req.body, [['nombre', 'nombre del rol']])
    const id = idParam(req.params.id)
    await tx(async (conn) => {
      const r = await conn.query(
        'UPDATE rol SET nombre = $1, descripcion = $2 WHERE id_rol = $3',
        [text(req.body.nombre), text(req.body.descripcion), id]
      )
      if (!r.rowCount) throw notFound('El rol no existe.')
      if (req.body.permisos) await guardarPermisos(conn, id, req.body.permisos)
    })
    res.json({ ...(await one('SELECT * FROM rol WHERE id_rol = $1', [id])), permisos: await permisosDeRol(id) })
  })
)

router.put(
  '/roles/:id/permisos',
  requireCan(['Roles', 'Editar']),
  wrap(async (req, res) => {
    const id = idParam(req.params.id)
    if (!(await one('SELECT 1 FROM rol WHERE id_rol = $1', [id]))) throw notFound('El rol no existe.')
    await tx((conn) => guardarPermisos(conn, id, req.body.permisos))
    res.json(await permisosDeRol(id))
  })
)

router.patch(
  '/roles/:id/estado',
  requireCan(['Roles', 'Cambiar estado']),
  wrap(async (req, res) => {
    const estado = estadoValido(req.body.estado)
    const id = idParam(req.params.id)
    if (id === 1 && estado === 'Inactivo') throw bad('El rol Administrador no se puede desactivar.')
    if (estado === 'Inactivo' && (await one("SELECT 1 FROM usuario WHERE id_rol = $1 AND estado = 'Activo'", [id]))) {
      throw bad('Hay usuarios activos con este rol. Cámbiales el rol antes de desactivarlo.')
    }
    const r = await pool.query(
      'UPDATE rol SET estado = $1 WHERE id_rol = $2',
      [estado, id]
    )
    if (!r.rowCount) throw notFound('El rol no existe.')
    res.json(await one('SELECT * FROM rol WHERE id_rol = $1', [id]))
  })
)