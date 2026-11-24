// Crea la base de datos (si no existe) y las tablas de sql/schema.sql. Se puede ejecutar varias veces.
import fs from 'node:fs'
import pg from 'pg'
import { config } from '../src/config.js'

const { database, ...conn } = config.db
const enLaNube = Boolean(conn.connectionString) // con DATABASE_URL la BD ya la creó el proveedor

// 1) Crear la base de datos conectándose a la BD de mantenimiento "postgres" (solo en local).
const admin = enLaNube ? null : new pg.Client({ ...conn, database: 'postgres' })
if (admin) try {
  await admin.connect()
  const existe = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
  if (!existe.rowCount) {
    await admin.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`)
    console.log(`Base de datos "${database}" creada.`)
  }
} catch (error) {
  console.error(`No se pudo conectar a PostgreSQL en ${conn.host}:${conn.port} con el usuario "${conn.user}": ${error.message}`)
  console.error('Revisa que PostgreSQL esté encendido y los datos DB_* del archivo .env.')
  process.exit(1)
} finally {
  await admin.end().catch(() => {})
}
const nombreBD = enLaNube ? config.dbLabel : database

// 2) Crear las tablas (CREATE TABLE IF NOT EXISTS: no falla si ya existen).
const sql = fs
  .readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => !/^(CREATE DATABASE|USE |\\c )/i.test(line.trim()))
  .join('\n')
  .replace(/CREATE TABLE (?!IF NOT EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS ')

const db = new pg.Client(enLaNube ? conn : { ...conn, database })
try {
  await db.connect()
  await db.query(sql)
  console.log(`Tablas listas en la base de datos "${nombreBD}".`)
} catch (error) {
  console.error(`Error creando las tablas: ${error.message}`)
  process.exitCode = 1
} finally {
  await db.end()
}
