import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { query } from './db.js'
import { forbidden, HttpError, wrap } from './util.js'

export const signToken = (payload) => jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpires })

function readToken(req) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return null
  try {
    return jwt.verify(header.slice(7), config.jwtSecret)
  } catch {
    throw new HttpError(401, 'Sesión inválida o vencida. Inicia sesión de nuevo.')
  }
}

export const authenticate = wrap(async (req, _res, next) => {
  const payload = readToken(req)
  if (!payload) throw new HttpError(401, 'Debes iniciar sesión.')
  req.auth = payload
  next()
})

export async function permisosDe(id_usuario) {
  const rows = await query(
    `SELECT p.nombre_permiso AS modulo, pr.nombre_privilegio AS privilegio
     FROM usuario u
     JOIN rol r ON r.id_rol = u.id_rol AND r.estado = 'Activo'
     JOIN rol_permiso rp ON rp.id_rol = r.id_rol
     JOIN permiso p ON p.id_permiso = rp.id_permiso
     JOIN privilegio pr ON pr.id_privilegio = rp.id_privilegio
     WHERE u.id_usuario = $1 AND u.estado = 'Activo'`,
    [id_usuario],
  )
  return new Set(rows.map((r) => `${r.modulo}|${r.privilegio}`))
}

export const requireCan = (...pairs) => [
  authenticate,
  wrap(async (req, _res, next) => {
    if (req.auth.kind !== 'staff') throw forbidden('Esta sección es solo para el personal.')
    req.perms = await permisosDe(req.auth.id)
    if (!pairs.some(([modulo, privilegio]) => req.perms.has(`${modulo}|${privilegio}`))) throw forbidden()
    next()
  }),
]

export const requireCliente = [
  authenticate,
  (req, _res, next) => {
    if (req.auth.kind !== 'cliente') return next(forbidden('Esta sección es solo para clientes.'))
    next()
  },
]

export const hasPerm = (req, modulo, privilegio) => req.perms?.has(`${modulo}|${privilegio}`) ?? false