import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { pool } from './db.js'
import { errorHandler, wrap } from './util.js'
import { router as auth } from './routes/auth.js'
import { router as catalogo } from './routes/catalogo.js'
import { router as dashboard } from './routes/dashboard.js'
import { router as estado } from './routes/estado.js'
import { router as operaciones } from './routes/operaciones.js'
import { router as personas } from './routes/personas.js'
import { router as tienda } from './routes/tienda.js'

export const app = express()
app.disable('x-powered-by')
app.use(cors({ origin: config.corsOrigin.split(',').map((o) => o.trim()), credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use('/uploads', express.static(path.resolve(config.uploadDir), { maxAge: '7d' }))

app.get('/api/health', wrap(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ ok: true, iva: config.ivaRate })
}))
app.use('/api/auth', auth)
app.use('/api/estado', estado)
app.use('/api/tienda', tienda)
app.use('/api/dashboard', dashboard)
app.use('/api', catalogo)
app.use('/api', personas)
app.use('/api', operaciones)

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }))

// En producción la API también sirve el frontend compilado (un solo servicio en Render).
const web = path.resolve(config.webDist instanceof URL ? fileURLToPath(config.webDist) : config.webDist)
if (fs.existsSync(path.join(web, 'index.html'))) {
  app.use(express.static(web, { index: false, maxAge: '1h' }))
  app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => res.sendFile(path.join(web, 'index.html')))
}
app.use(errorHandler)