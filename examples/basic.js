import { dirname } from 'path'
import { fileURLToPath } from 'url'
import BunOpenAPI from '../src/index'

const __dirname = dirname(fileURLToPath(import.meta.url))

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
}

const api = new BunOpenAPI({
  definition: `${__dirname}/openapi.yaml`
})

api.register('getHello', async (req) => {
  return Response.json({ message: 'Hello, from Bun!'}, {
    status: 200,
    headers: corsHeaders,
  })
})

api.register('getUser', async (req) => {
  const { id } = req.params
  return Response.json({ status: 'success', created: Date.now(), data: { userId: id }}, {
    status: 200,
    headers: corsHeaders,
  })
})

api.register('getProduct', async (req) => {
  const { id } = req.params
  return Response.json({ status: 'success', created: Date.now(), data: { productId: id }}, {
    status: 200,
    headers: corsHeaders,
  })
})

api.register('createAdmin', async (req) => {
  return Response.json({ status: 'success', created: Date.now(), data: null }, { 
    status: 201,
    headers: corsHeaders,
  })
})

api.registerSecurity('apiKey', async (req) => {
  const key = req.headers.get('x-api-key')
  return key === 'secret123' || false
})

api.registerSecurity('bearerAuth', async (req) => {
  const auth = req.headers.get('Authorization')
  const token = auth?.split(' ')?.[1]
  return token === 'my-bearer-token' || false
})

const routes = await api.routes()

const port = 3000

Bun.serve({
  routes,
  port,
  async fetch(req) {
    return new Response('Not Found', { status: 404 })
  }
})

console.log(`Server started and listening on http://localhost:${port}`)