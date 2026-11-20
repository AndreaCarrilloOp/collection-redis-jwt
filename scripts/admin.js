import { database, closeDatabase } from '../netlify/lib/redisDB.js'
import { get, save } from '../netlify/lib/store.js'
const email = process.argv[2]?.trim().toLowerCase()
if (!email) throw new Error('Uso: npm run admin -- correo')
const db = database()
try {
  const user = await get(db,'users',email)
  if (!user) throw new Error('Registre primero la cuenta desde la aplicación')
  await save(db,'users',email,{...user,role:'admin'})
  console.log('Rol admin asignado. Cierre sesión e ingrese nuevamente.')
} finally { await closeDatabase() }
