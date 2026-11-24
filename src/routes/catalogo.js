// Categorías (simple) y Productos (compuesto: Producto + Categoria + Galeria_fotos).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { requireCan } from '../auth.js'
import { config } from '../config.js'
import { one, pool, query } from '../db.js'
import { PRODUCTO_SELECT, productoConFotos } from '../queries.js'
import { bad, conflict, need, notFound, num, text, wrap } from '../util.js'

export const router = Router()

/* ------------------------------- Categorías ------------------------------- */

// Cualquier usuario del panel puede listarlas (se usan en selects).
router.get(
  '/categorias',
  requireCan(['Categorías', 'Consultar'], ['Productos', 'Consultar'], ['Productos', 'Crear'], ['Productos', 'Editar']),
  wrap(async (_req, res) => {
    res.json(
      await query(
        `SELECT c.*, (SELECT COUNT(*)::int FROM producto p WHERE p.id_categoria = c.id_categoria) AS productos
         FROM categoria c
         ORDER BY c.nombre`
      )
    )
  })
)

router.post(
  '/categorias',
  requireCan(['Categorías', 'Crear']),
  wrap(async (req, res) => {
    need(req.body, [['nombre', 'nombre']])
    const r = await pool.query(
      'INSERT INTO categoria (nombre) VALUES ($1) RETURNING id_categoria',
      [text(req.body.nombre)]
    )
    res.status(201).json(await one('SELECT * FROM categoria WHERE id_categoria = $1', [r.rows[0].id_categoria]))
  })
)

router.put(
  '/categorias/:id',
  requireCan(['Categorías', 'Editar']),
  wrap(async (req, res) => {
    need(req.body, [['nombre', 'nombre']])
    const r = await pool.query(
      'UPDATE categoria SET nombre = $1 WHERE id_categoria = $2',
      [text(req.body.nombre), req.params.id]
    )
    if (!r.rowCount) throw notFound('La categoría no existe.')
    res.json(await one('SELECT * FROM categoria WHERE id_categoria = $1', [req.params.id]))
  })
)

router.delete(
  '/categorias/:id',
  requireCan(['Categorías', 'Eliminar']),
  wrap(async (req, res) => {
    const used = await one('SELECT COUNT(*)::int AS n FROM producto WHERE id_categoria = $1', [req.params.id])
    if (used.n) throw conflict('No se puede eliminar: hay productos en esta categoría.')
    const r = await pool.query('DELETE FROM categoria WHERE id_categoria = $1', [req.params.id])
    if (!r.rowCount) throw notFound('La categoría no existe.')
    res.status(204).end()
  })
)

/* ------------------------------- Productos ------------------------------- */

function datosProducto(b) {
  need(b, [['codigo_barra', 'código de barras'], ['nombre', 'nombre'], ['id_categoria', 'categoría']])
  const d = {
    id_categoria: num(b.id_categoria),
    codigo_barra: text(b.codigo_barra),
    nombre: text(b.nombre),
    descripcion: text(b.descripcion).slice(0, 255),
    stock_min: num(b.stock_min ?? 0),
    stock_max: num(b.stock_max ?? 0),
    precio_compra: num(b.precio_compra ?? 0),
    precio_venta: num(b.precio_venta),
    estado: text(b.estado) || 'Activo',
  }
  if (!Number.isInteger(d.id_categoria)) throw bad('Selecciona una categoría.')
  if (!Number.isInteger(d.stock_min) || d.stock_min < 0 || !Number.isInteger(d.stock_max) || d.stock_max < d.stock_min) {
    throw bad('El stock máximo debe ser mayor o igual al mínimo.')
  }
  if (!(d.precio_compra >= 0) || !(d.precio_venta > 0)) throw bad('Revisa los precios de compra y venta.')
  if (!['Activo', 'Inactivo'].includes(d.estado)) throw bad('Estado no válido.')
  return d
}

const verProductos = ['Productos', 'Consultar']

// GET /api/productos?q=&id_categoria=&estado=&alerta=   (también lo usan los formularios de compras y pedidos)
router.get(
  '/productos',
  requireCan(verProductos, ['Compras', 'Crear'], ['Compras', 'Editar'], ['Pedidos', 'Crear'], ['Pedidos', 'Editar']),
  wrap(async (req, res) => {
    const where = []
    const params = []
    if (req.query.q) {
      params.push(`%${req.query.q}%`, `%${req.query.q}%`)
      where.push(`(t.nombre ILIKE $${params.length - 1} OR t.codigo_barra ILIKE $${params.length})`)
    }
    if (req.query.id_categoria) {
      params.push(req.query.id_categoria)
      where.push(`t.id_categoria = $${params.length}`)
    }
    if (req.query.estado) {
      params.push(req.query.estado)
      where.push(`t.estado = $${params.length}`)
    }
    if (req.query.alerta) {
      params.push(req.query.alerta)
      where.push(`t.alerta_stock = $${params.length}`)
    }
    res.json(
      await query(
        `SELECT t.* FROM (${PRODUCTO_SELECT}) t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.nombre`,
        params
      )
    )
  })
)

router.get(
  '/productos/:id',
  requireCan(verProductos, ['Compras', 'Crear'], ['Pedidos', 'Crear']),
  wrap(async (req, res) => {
    res.json(await productoConFotos(req.params.id))
  })
)

// existencia_actual NO se envía ni se edita: solo cambia con compras, pedidos y devoluciones.
router.post(
  '/productos',
  requireCan(['Productos', 'Crear']),
  wrap(async (req, res) => {
    const d = datosProducto(req.body)
    const r = await pool.query(
      `INSERT INTO producto (
         id_categoria, codigo_barra, nombre, descripcion,
         stock_min, stock_max, existencia_actual, precio_compra, precio_venta, estado
       )
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9)
       RETURNING id_producto`,
      [d.id_categoria, d.codigo_barra, d.nombre, d.descripcion, d.stock_min, d.stock_max, d.precio_compra, d.precio_venta, d.estado]
    )
    res.status(201).json(await productoConFotos(r.rows[0].id_producto))
  })
)

router.put(
  '/productos/:id',
  requireCan(['Productos', 'Editar']),
  wrap(async (req, res) => {
    const d = datosProducto(req.body)
    const r = await pool.query(
      `UPDATE producto
       SET id_categoria = $1, codigo_barra = $2, nombre = $3, descripcion = $4,
           stock_min = $5, stock_max = $6, precio_compra = $7, precio_venta = $8, estado = $9
       WHERE id_producto = $10`,
      [d.id_categoria, d.codigo_barra, d.nombre, d.descripcion, d.stock_min, d.stock_max, d.precio_compra, d.precio_venta, d.estado, req.params.id]
    )
    if (!r.rowCount) throw notFound('El producto no existe.')
    res.json(await productoConFotos(req.params.id))
  })
)

router.patch(
  '/productos/:id/estado',
  requireCan(['Productos', 'Cambiar estado']),
  wrap(async (req, res) => {
    if (!['Activo', 'Inactivo'].includes(req.body.estado)) throw bad('Estado no válido.')
    const r = await pool.query(
      'UPDATE producto SET estado = $1 WHERE id_producto = $2',
      [req.body.estado, req.params.id]
    )
    if (!r.rowCount) throw notFound('El producto no existe.')
    res.json(await productoConFotos(req.params.id))
  })
)

/* --------------------------- Galería de fotos --------------------------- */

fs.mkdirSync(config.uploadDir, { recursive: true })
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`),
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype) ? cb(null, true) : cb(bad('Solo se permiten imágenes JPG, PNG, WEBP o GIF.'))),
})

// POST /api/productos/:id/fotos   (multipart: campo "foto", opcional "texto_alternativo")
router.post(
  '/productos/:id/fotos',
  requireCan(['Productos', 'Crear'], ['Productos', 'Editar']),
  upload.single('foto'),
  wrap(async (req, res) => {
    if (!req.file) throw bad('Adjunta una imagen en el campo "foto".')
    const producto = await one('SELECT nombre FROM producto WHERE id_producto = $1', [req.params.id])
    if (!producto) {
      fs.unlink(req.file.path, () => {})
      throw notFound('El producto no existe.')
    }
    await pool.query(
      'INSERT INTO galeria_fotos (id_producto, url_imagen, texto_alternativo) VALUES ($1, $2, $3)',
      [req.params.id, `/uploads/${req.file.filename}`, (text(req.body.texto_alternativo) || producto.nombre).slice(0, 150)]
    )
    res.status(201).json(await productoConFotos(req.params.id))
  })
)

router.delete(
  '/productos/:id/fotos/:id_foto',
  requireCan(['Productos', 'Editar']),
  wrap(async (req, res) => {
    const foto = await one(
      'SELECT * FROM galeria_fotos WHERE id_galeria_fotos = $1 AND id_producto = $2',
      [req.params.id_foto, req.params.id]
    )
    if (!foto) throw notFound('La foto no existe.')
    await pool.query('DELETE FROM galeria_fotos WHERE id_galeria_fotos = $1', [foto.id_galeria_fotos])
    if (foto.url_imagen.startsWith('/uploads/')) fs.unlink(path.join(config.uploadDir, path.basename(foto.url_imagen)), () => {})
    res.status(204).end()
  })
)