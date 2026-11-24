import 'dotenv/config'

// Conexión: DATABASE_URL (Render, Railway, Neon...) o los datos sueltos DB_* del .env local.
// DB_SSL=true activa SSL (necesario al conectarse a una BD en la nube desde fuera de su red).
const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
const db = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'nexacoredb',
      ssl,
    }

export const config = {
  port: Number(process.env.PORT || 3000),
  db,
  // Nombre de la BD para los mensajes (con DATABASE_URL se toma de la URL).
  dbLabel: process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : db.database,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-cambiar',
  jwtExpires: process.env.JWT_EXPIRES || '8h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // La empresa no cobra IVA: tarifa 0, pero iva e iva_producto se guardan igualmente.
  ivaRate: Number(process.env.IVA_RATE ?? 0),
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  // Carpeta del frontend compilado (npm run build en nexacore-react). Si existe, la API también sirve la web.
  webDist: process.env.WEB_DIST || new URL('../../nexacore-react/dist', import.meta.url),
}

if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-secret-cambiar') {
  throw new Error('Define JWT_SECRET en producción.')
}
