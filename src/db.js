import pg from 'pg'
import { config } from './config.js'

const { Pool, types } = pg

// Convierte NUMERIC / DECIMAL (OID 1700) a número JS en lugar de string.
types.setTypeParser(1700, (val) => (val === null ? null : Number(val)))

export const pool = new Pool({
  ...config.db,
  max: 10,
})

// Ejecuta fn dentro de una transacción (commit si termina bien, rollback si lanza error).
export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const query = async (sql, params = []) => {
  const res = await pool.query(sql, params)
  return res.rows
}

export const one = async (sql, params = []) => (await query(sql, params))[0] ?? null