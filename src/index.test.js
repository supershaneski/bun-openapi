// src/index.test.js
import { describe, it, expect, beforeAll } from 'bun:test'
import BunOpenAPI from './index.js'
import { parse } from 'yaml'

const simpleSpec = `
openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths:
  /hello:
    get:
      operationId: getHello
      responses:
        '200':
          description: OK
  /test:
    get:
      operationId: getTest
      responses:
        '200':
          description: OK
  /users/:id:
    get:
      operationId: getUser
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        '200':
          description: OK
  /admin:
    post:
      operationId: createAdmin
      security:
        - apiKey: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
      responses:
        '201':
          description: Created
components:
  securitySchemes:
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
security:
  - apiKey: []
`

describe('@supershaneski/openapi', () => {
  let api
  let routes

  beforeAll(async () => {
    // Write spec to temp file
    await Bun.write('openapi.yaml', simpleSpec)

    api = new BunOpenAPI({
      definition: 'openapi.yaml'
    })

    // Register handlers
    api.register('getHello', async (req) => {
      return new Response('world')
    })

    api.register('getUser', async (req) => {
      const { id } = req.params
      return Response.json({ id: id, name: 'Lima' })
    })

    let authCalled = false
    api.registerSecurity('apiKey', async (req, scopes) => {
      authCalled = true
      const key = req.headers.get('x-api-key')
      return key === 'secret123'
    })

    routes = await api.routes()
  })

  it('serves simple route', async () => {
    const handler = routes['/hello']?.GET
    const req = new Request('http://localhost/hello', {
      headers: {
        'x-api-key': 'secret123'
      }
    })
    const res = await handler(req)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('world')
  })

  it('extracts path parameters', async () => {
    const handler = routes['/users/:id']?.GET
    const req = new Request('http://localhost/users/42', {
      headers: {
        'x-api-key': 'secret123'
      }
    })
    const res = await handler(req)
    const json = await res.json()
    expect(json).toEqual({ id: '42', name: 'Lima' })
  })

  it('enforces security (global + operation)', async () => {
    const handler = routes['/admin']?.POST

    // Missing header → 401
    const req1 = new Request('http://localhost/admin', { method: 'POST' })
    const res1 = await handler(req1)
    expect(res1.status).toBe(401)

    // Correct header → passes
    const req2 = new Request('http://localhost/admin', {
      method: 'POST',
      headers: { 'x-api-key': 'secret123' }
    })
    const res2 = await handler(req2)
    expect(res2.status).toBe(501) // Not Implemented (we didn't register createAdmin)
  })

  it('handles CORS preflight', async () => {
    const handler = routes['/hello']?.OPTIONS
    const res = await handler(new Request('http://localhost/hello', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns 501 for unregistered operationId', async () => {
    const handler = routes['/test']?.GET
    const req = new Request('http://localhost/test', {
      headers: {
        'x-api-key': 'secret123'
      }
    })
    const res = await handler(req)
    expect(res.status).toBe(501)
  })
})