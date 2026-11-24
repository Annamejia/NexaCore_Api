import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { authenticate, permisosDe, signToken } from '../auth.js'
import { one, pool } from '../db.js'
import { bad, checkPassword, EMAIL_RE, NAME_RE, need, text, wrap, HttpError } from '../util.js'

export const router = Router()

const nombre = (p) => [p.primer_nombre, p.segundo_nombre, p.primer_apellido, p.segundo_apellido].filter(Boolean).join(' ')

async function sesionDe(kind, id) {
  if (kind === 'cliente') {
    const c = await one("SELECT * FROM cliente WHERE id_cliente = $1 AND estado = 'Activo'", [id])
    return c && { kind, id, name: c.primer_nombre, full_name: nombre(c), email: c.correo }
  }
  const u = await one(
    `SELECT u.*, r.nombre AS rol
     FROM usuario u
     JOIN rol r ON r.id_rol = u.id_rol
     WHERE u.id_usuario = $1 AND u.estado = 'Activo' AND r.estado = 'Activo'`,
    [id],
  )
  if (!u) return null
  const permisos = [...(await permisosDe(id))].map((k) => k.split('|'))
  return { kind, id, name: u.primer_nombre, full_name: nombre(u), email: u.correo, id_rol: u.id_rol, rol: u.rol, permisos }
}

const respuesta = async (kind, id) => {
  const session = await sesionDe(kind, id)
  return { token: signToken({ kind, id }), session }
}

// POST /api/auth/login  { email, password }  → { token, session }
router.post('/login', wrap(async (req, res) => {
  const email = text(req.body.email).toLowerCase()
  const password = String(req.body.password ?? '')
  if (!email || !password) throw bad('Completa el correo y la contraseña.')
  if (!EMAIL_RE.test(email)) throw bad('Ingresa un correo electrónico válido.')
  const usuario = await one('SELECT * FROM usuario WHERE correo = $1', [email])
  const cliente = usuario ? null : await one('SELECT * FROM cliente WHERE correo = $1', [email])
  if (!usuario && !cliente) throw new HttpError(401, 'No has sido registrado con ese correo. Crea tu cuenta para continuar.')
  const row = usuario ?? cliente
  if (!(await bcrypt.compare(password, row.password))) throw new HttpError(401, 'Correo o contraseña incorrectos. Verifica tus datos.')
  if (row.estado !== 'Activo') throw new HttpError(403, 'Esta cuenta está inactiva. Solicita la activación a un Administrador.')
  const kind = usuario ? 'staff' : 'cliente'
  const id = usuario ? usuario.id_usuario : cliente.id_cliente
  const out = await respuesta(kind, id)
  if (!out.session) throw new HttpError(403, 'Tu rol está inactivo. Contacta a un Administrador.')
  res.json(out)
}))

// POST /api/auth/register  → crea un Cliente (cualquier persona puede registrarse) y abre sesión
router.post('/register', wrap(async (req, res) => {
  const b = req.body
  // Vendedor / Administrador: la cuenta nace Inactiva y un Administrador debe activarla en Usuarios.
  if (['vendedor', 'administrador'].includes(text(b.tipo).toLowerCase())) {
    need(b, [['primer_nombre', 'primer nombre'], ['primer_apellido', 'primer apellido'], ['documento', 'documento'], ['correo', 'correo']])
    for (const [k, label] of [['primer_nombre', 'primer nombre'], ['segundo_nombre', 'segundo nombre'], ['primer_apellido', 'primer apellido'], ['segundo_apellido', 'segundo apellido']]) {
      if (text(b[k]) && !NAME_RE.test(text(b[k]))) throw bad(`El ${label} solo puede tener letras.`)
    }
    const correo = text(b.correo).toLowerCase()
    if (!/^\d{6,15}$/.test(text(b.documento))) throw bad('El documento debe tener entre 6 y 15 dígitos, sin puntos.')
    if (!EMAIL_RE.test(correo)) throw bad('Ingresa un correo electrónico válido.')
    const msg = checkPassword(b.password)
    if (msg) throw bad(msg)
    if (b.password !== b.confirm_password) throw bad('Las contraseñas no coinciden.')
    if (await one('SELECT 1 FROM usuario WHERE correo = $1 UNION ALL SELECT 1 FROM cliente WHERE correo = $1', [correo])) {
      throw new HttpError(409, 'Ese correo ya está registrado. Inicia sesión.')
    }
    const rol = await one('SELECT id_rol FROM rol WHERE LOWER(nombre) = $1', [text(b.tipo).toLowerCase()])
    if (!rol) throw bad('El rol solicitado no existe.')
    await pool.query(
      `INSERT INTO usuario (id_rol, tipo_documento, numero_documento, primer_nombre, segundo_nombre,
                            primer_apellido, segundo_apellido, correo, password, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Inactivo')`,
      [rol.id_rol, text(b.tipo_documento) || 'CC', text(b.documento), text(b.primer_nombre), text(b.segundo_nombre),
        text(b.primer_apellido), text(b.segundo_apellido), correo, await bcrypt.hash(b.password, 10)],
    )
    return res.status(201).json({ pendiente: true })
  }
  need(b,[['primer_nombre', 'primer nombre'], ['primer_apellido', 'primer apellido'], ['documento', 'documento'], ['correo', 'correo'], ['telefono', 'teléfono'], ['departamento', 'departamento'], ['municipio', 'municipio'], ['direccion', 'dirección']])
  for (const [k, label] of [['primer_nombre', 'primer nombre'], ['segundo_nombre', 'segundo nombre'], ['primer_apellido', 'primer apellido'], ['segundo_apellido', 'segundo apellido']]) {
    if (text(b[k]) && !NAME_RE.test(text(b[k]))) throw bad(`El ${label} solo puede tener letras.`)
  }
  const correo = text(b.correo).toLowerCase()
  if (!/^\d{6,15}$/.test(text(b.documento))) throw bad('El documento debe tener entre 6 y 15 dígitos, sin puntos.')
  if (!EMAIL_RE.test(correo)) throw bad('Ingresa un correo electrónico válido.')
  if (!/^\d{7,12}$/.test(text(b.telefono).replace(/\s/g, ''))) throw bad('El teléfono debe tener entre 7 y 12 dígitos.')
  const msg = checkPassword(b.password)
  if (msg) throw bad(msg)
  if (b.password !== b.confirm_password) throw bad('Las contraseñas no coinciden.')
  if (await one('SELECT 1 FROM usuario WHERE correo = $1', [correo])) throw new HttpError(409, 'Ese correo ya está registrado.')
  const hash = await bcrypt.hash(b.password, 10)
  const r = await pool.query(
    `INSERT INTO cliente (
       tipo_documento, documento, primer_nombre, segundo_nombre,
       primer_apellido, segundo_apellido, correo, password,
       telefono, departamento, municipio, direccion, estado
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Activo')
     RETURNING id_cliente`,
    [
      text(b.tipo_documento) || 'CC',
      text(b.documento),
      text(b.primer_nombre),
      text(b.segundo_nombre),
      text(b.primer_apellido),
      text(b.segundo_apellido),
      correo,
      hash,
      text(b.telefono).replace(/\s/g, ''),
      text(b.departamento),
      text(b.municipio),
      text(b.direccion),
    ],
  )
  res.status(201).json(await respuesta('cliente', r.rows[0].id_cliente))
}))

// GET /api/auth/me → sesión vigente con sus permisos
router.get('/me', authenticate, wrap(async (req, res) => {
  const session = await sesionDe(req.auth.kind, req.auth.id)
  if (!session) throw new HttpError(401, 'La cuenta ya no está activa.')
  res.json({ session })
}))