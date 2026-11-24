import { config } from './config.js'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
export const bad = (message) => new HttpError(400, message)
export const notFound = (message = 'No encontrado.') => new HttpError(404, message)
export const conflict = (message) => new HttpError(409, message)
export const forbidden = (message = 'No tienes permiso para esta acción.') => new HttpError(403, message)

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

export const text = (value) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim())
export const num = (value) => (value === '' || value === null || value === undefined ? NaN : Number(value))
export const isInt = (value) => Number.isInteger(num(value))

export function need(body, fields) {
  const missing = fields.filter(([key]) => !text(body?.[key]))
  if (missing.length) throw bad(`Faltan campos obligatorios: ${missing.map(([, label]) => label).join(', ')}.`)
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const NAME_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+$/

// Reglas de contraseña del proyecto: 10 a 20 caracteres y al menos un carácter especial.
export function checkPassword(password) {
  if (!password) return 'Escribe la contraseña.'
  if (password.length < 10) return 'La contraseña debe tener mínimo 10 caracteres.'
  if (password.length > 20) return 'La contraseña debe tener máximo 20 caracteres.'
  if (!/[^A-Za-z0-9\s]/.test(password)) return 'La contraseña debe incluir al menos un carácter especial.'
  return ''
}

export const iva = (cantidad, precio) => Math.round(cantidad * precio * config.ivaRate * 100) / 100

// Une líneas repetidas del mismo producto y valida cantidades.
export function mergeLines(items) {
  if (!Array.isArray(items) || !items.length) throw bad('Agrega al menos un producto al detalle.')
  const map = new Map()
  for (const item of items) {
    const id = num(item?.id_producto)
    const cantidad = num(item?.cantidad)
    if (!Number.isInteger(id) || id <= 0) throw bad('Hay un ítem sin producto.')
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw bad('Las cantidades deben ser enteros mayores a cero.')
    const precio = item.precio_unitario === undefined ? undefined : num(item.precio_unitario)
    if (precio !== undefined && !(precio >= 0)) throw bad('El precio unitario no puede ser negativo.')
    const prev = map.get(id)
    map.set(id, { id_producto: id, cantidad: (prev?.cantidad ?? 0) + cantidad, precio_unitario: precio ?? prev?.precio_unitario })
  }
  return [...map.values()].sort((a, b) => a.id_producto - b.id_producto)
}

export function errorHandler(error, _req, res, _next) {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message })
  if (error?.code === '22P02') {
    return res.status(400).json({ error: 'Formato de identificador o dato numérico no válido.' })
  }
  if (error?.code === '23505' || error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos únicos (código, correo o documento).' })
  }
  if (error?.code === '23503' || error?.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: 'No se puede eliminar: el registro está en uso.' })
  }
  if (error?.name === 'MulterError') return res.status(400).json({ error: `Archivo no válido: ${error.message}` })
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' })
  console.error(error)
  return res.status(500).json({ error: 'Error interno del servidor.' })
}