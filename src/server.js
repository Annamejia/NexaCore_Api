import { app } from './app.js'
import { config } from './config.js'
import { pool } from './db.js'

try {
  await pool.query('SELECT 1')
} catch (error) {
  console.error(`No se pudo conectar a PostgreSQL (BD "${config.dbLabel}"): ${error.message}`)
  console.error('Revisa tu archivo .env y ejecuta `npm run migrate` y `npm run seed`.')
  process.exit(1)
}
app.listen(config.port, () => console.log(`API NexaCore lista en http://localhost:${config.port}/api`))