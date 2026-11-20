import { randomUUID } from 'node:crypto'
import { get, list, remove, insert, counter, key } from '../lib/store.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { database } from '../lib/redisDB.js'

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
const error = (message, status = 400) => json({ error: message }, status)
const collections = { albums: 'albums', artists: 'artists', subgenres: 'subgenres' }
const required = { albums: ['title','release_year','label','artist_id','subgenre_id'], artists: ['name','country','main_instrument'], subgenres: ['name','origin_decade','origin_place','characteristics'] }
const defaults = { albums: '/images/albums/default.webp', artists: '/images/artists/default.webp', subgenres: '/images/subgenres/default.webp' }
function auth(request) {
  const token = /^Bearer (.+)$/i.exec(request.headers.get('authorization') || '')?.[1]
  if (!token) return null
  try { return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }) } catch { return null }
}
async function nextId(db, resource) { return String(await db.incr(counter(resource))) }
async function withNames(db, doc) {
  const [artist, subgenre] = await Promise.all([get(db,'artists',doc.artist_id), get(db,'subgenres',doc.subgenre_id)])
  return { ...doc, artist_name: artist?.name || '', subgenre_name: subgenre?.name || '' }
}
async function relationsValid(db, body) {
  return Boolean(await get(db,'artists',String(body.artist_id)) && await get(db,'subgenres',String(body.subgenre_id)))
}
async function currentUser(db, identity) {
  if (!identity || typeof identity.email !== 'string') return null
  const user = await get(db,'users',identity.email)
  return user?.id === identity.sub ? user : null
}
async function handle(request) {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  const apiAt = parts.indexOf('api')
  const path = apiAt >= 0 ? parts.slice(apiAt + 1) : parts.slice(parts.indexOf('functions') + 2)
  const [resource, id] = path
  if (path.length > 2) return error('Ruta no encontrada',404)
  const method = request.method
  if (method === 'OPTIONS') return new Response(null,{status:204,headers:{Allow:'GET, POST, PUT, DELETE, OPTIONS'}})
  if (resource === 'auth' && path.length === 2) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) return error('Configuración JWT incompleta', 500)
    if (id === 'me' && method === 'GET') {
      const identity = auth(request)
      if (!identity) return error('Token ausente, inválido o expirado', 401)
      const db = await database()
      const user = await currentUser(db, identity)
      if (!user) return error('Sesión no válida', 401)
      return json({ user: { name: user.name, email: user.email, role: user.role } })
    }
    if (method !== 'POST') return error('Método no permitido', 405)
    const body = await request.json().catch(() => ({}))
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error('JSON inválido')
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || Buffer.byteLength(password) > 72) return error('Correo válido y contraseña de al menos 8 caracteres requeridos')
    const db = await database()
    if (id === 'register') {
      const name = String(body.name || '').trim()
      if (!name) return error('El nombre es obligatorio')
      const passwordHash = await bcrypt.hash(password, 12)
      if (!await insert(db,'users',email,{ id: randomUUID(), name, email, passwordHash, role: 'user', createdAt: new Date().toISOString() })) return error('Correo ya registrado', 409)
      return json({ message: 'Usuario registrado' }, 201)
    }
    if (id === 'login') {
      const user = await get(db,'users',email)
      if (!user || !await bcrypt.compare(password, user.passwordHash)) return error('Credenciales incorrectas', 401)
      const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '2h', algorithm: 'HS256' })
      return json({ token, user: { name: user.name, email: user.email, role: user.role } })
    }
    return error('Ruta no encontrada', 404)
  }
  if (!Object.hasOwn(collections, resource) || path.length > 2) return error('Recurso no encontrado', 404)
  if (!['GET','POST','PUT','DELETE'].includes(method)) return error('Método no permitido', 405)
  // También las consultas requieren JWT: el catálogo no se expone antes del login.
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) return error('Configuración JWT incompleta', 500)
  const identity = auth(request)
  if (!identity) return error('Token ausente, inválido o expirado', 401)
  const db = await database()
  const user = await currentUser(db, identity)
  if (!user) return error('Token ausente, inválido o expirado', 401)
  if (user.role !== 'user' && user.role !== 'admin') return error('No tiene permisos', 403)
  // Autenticación: JWT válido. Autorización: solo admin modifica el catálogo.
  if (method !== 'GET' && user.role !== 'admin') return error('Solo el administrador puede modificar el catálogo', 403)
  if (method === 'GET') {
    if (id) {
      const doc = await get(db,resource,id)
      if (!doc) return error('Registro no encontrado', 404)
      return json(resource === 'albums' ? await withNames(db, doc) : doc)
    }
    const docs = await list(db,resource)
    docs.sort((a,b) => Number(a.id)-Number(b.id))
    return json(resource === 'albums' ? await Promise.all(docs.map(doc => withNames(db,doc))) : docs)
  }
  const body = method === 'DELETE' ? {} : await request.json().catch(() => ({}))
  if (!body || typeof body !== 'object' || Array.isArray(body)) return error('JSON inválido')
  // El Proyecto 1 también admitía POST /:recurso/:id para actualizar.
  const operation = method === 'POST' && id ? (body._method === 'DELETE' ? 'DELETE' : 'PUT') : method
  if (operation === 'DELETE') {
    if (!id) return error('Falta el identificador')
    if (resource !== 'albums' && (await list(db,'albums')).some(album => album[resource === 'artists' ? 'artist_id' : 'subgenre_id'] === id)) return error('Existen álbumes relacionados', 409)
    const result = await remove(db,resource,id)
    return result ? new Response(null, { status: 204 }) : error('Registro no encontrado', 404)
  }
  if (operation === 'PUT' && !id) return error('Falta el identificador')
  if (required[resource].some(key => body[key] === undefined || body[key] === null || String(body[key]).trim() === '')) return error('Faltan campos obligatorios')
  if (resource === 'albums' && !await relationsValid(db, body)) return error('Artista o subgénero no existe')
  const fields = Object.fromEntries(Object.keys(body).filter(key => [...required[resource], 'description', 'image', ...(resource === 'artists' ? ['birth_year'] : [])].includes(key)).map(key => [key,body[key]]))
  if (resource === 'albums') { fields.artist_id = String(fields.artist_id); fields.subgenre_id = String(fields.subgenre_id) }
  fields.image ||= defaults[resource]
  if (operation === 'POST') {
    let newId, doc
    do { newId = await nextId(db, resource); doc = { id: newId, ...fields } } while (!await insert(db,resource,newId,doc))
    return json(resource === 'albums' ? await withNames(db,doc) : doc, 201)
  }
  const previous = await get(db,resource,id)
  if (!previous) return error('Registro no encontrado', 404)
  const doc = { ...previous, ...fields, id }
  if (!await db.set(key(resource,id), JSON.stringify(doc), 'XX')) return error('Registro no encontrado',404)
  return json(resource === 'albums' ? await withNames(db,doc) : doc)
}
export default async (request) => {
  try { return await handle(request) }
  catch (e) { console.error(e); return error('Error interno del servidor', 500) }
}
