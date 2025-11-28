import { dirname } from 'path'
import { fileURLToPath } from 'url'
import BunOpenAPI from '../src/index'

const __dirname = dirname(fileURLToPath(import.meta.url))

const api = new BunOpenAPI({
  definition: `${__dirname}/openapi.yaml`
})

api.register('getHello', async (req) => {
  return Response.json({ message: 'Hello, from Bun!' })
})

api.register('getUser', async (req) => {
  const { id } = req.params
  return Response.json({ status: 'success', created: Date.now(), data: { userId: id }})
})

api.register('getProduct', async (req) => {
  const { id } = req.params
  return Response.json({ status: 'success', created: Date.now(), data: { productId: id }})
})

api.registerSecurity('apiKey', async (req) => {
  const key = req.headers.get('x-api-key')
  return key === 'secret123' || false
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