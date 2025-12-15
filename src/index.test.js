import { describe, it, expect, beforeAll, afterAll, spyOn } from 'bun:test'
import { unlink } from 'node:fs/promises'
import BunOpenAPI from './index.js'

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
          content:
            text/plain:
              schema:
                type: string
  /test:
    get:
      operationId: getTest
      responses:
        '200':
          description: OK
  /users:
    post:
      operationId: createUser
      security:
        - apiKey: []
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                required:
                  - id
        '400':
          description: Bad request
        '401':
          description: Unauthorized
  /users/{id}:
    get:
      operationId: getUser
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: integer
                  name:
                    type: string
                required:
                  - id
                  - name
  /admin:
    post:
      operationId: createAdmin
      security:
        - apiKey: []
      responses:
        '201':
          description: Created
          content:
            text/plain:
              schema:
                type: string
        '400':
          description: Bad request
        '401':
          description: Unauthorized
  /search:
    get:
      operationId: searchThings
      parameters:
        - name: query
          in: query
          required: true
          schema:
            type: string
        - name: limit
          in: query
          required: false
          schema:
            type: integer
      responses:
        '200': 
          description: OK
        '400':
          description: Bad request
        '401':
          description: Unauthorized
        '500': 
          description: Server error
components:
  securitySchemes:
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
security:
  - apiKey: []
`

describe('@supershaneski/bun-openapi', () => {
  let api
  let routes

  beforeAll(async () => {
    // Write spec to temp file
    await Bun.write('openapi.yaml', simpleSpec)

    api = new BunOpenAPI({
      definition: 'openapi.yaml',
      strict: true,
      development: true,
    })

    // Register handlers
    api.register('getHello', async (req) => {
      return new Response('Hello, world!')
    })

    api.register('createUser', async (req) => {
      // schema expects response payload to have "id" properties
      // but we will send only "created" to trigger response validation error
      return Response.json({ created: Date.now() }, { status: 201 })
    })

    api.register('getUser', async (req) => {
      const { id } = req.params
      return Response.json({ id: id, name: 'John' })
    })

    // Global security handler
    api.registerSecurity('apiKey', async (req, scopes) => {
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
    expect(await res.text()).toBe('Hello, world!')
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
    expect(json).toEqual({ id: 42, name: 'John' })
  })

  it('validates path parameters sending wrong type', async () => {
    const handler = routes['/users/:id']?.GET
    // getUser "id" path parameter is type integer
    // "abc" is not integer therefore this should trigger request validation error
    const req = new Request('http://localhost/users/abc', {
      headers: {
        'x-api-key': 'secret123'
      }
    })
    const res = await handler(req)
    expect(res.status).toBe(400)
  })

  it('enforces security (global + operation)', async () => {
    const handler = routes['/admin']?.POST

    // Missing header → 401
    const req1 = new Request('http://localhost/admin', { 
      method: 'POST', 
      headers: {'Content-Type':'application/json'} 
    })
    const res1 = await handler(req1)
    expect(res1.status).toBe(401)

    // Correct header → passes
    const req2 = new Request('http://localhost/admin', {
      method: 'POST',
      headers: { 'x-api-key': 'secret123', 'Content-Type':'application/json' }
    })
    const res2 = await handler(req2)
    expect(res2.status).toBe(501) // Not Implemented (we didn't register createAdmin)
  })

  it('validates query parameters checking required and optional', async () => {
    api.register('searchThings', async (req) => {
        return new Response('Search results', { status: 200 })
    })
    
    // Re-generate routes to include the new registration
    routes = await api.routes() 
    const handler = routes['/search'].GET

    // Missing required "query" parameter
    const req = new Request('http://localhost/search?limit=5', {
      headers: {
        'x-api-key': 'secret123'
      }
    })
    const res = await handler(req)
    expect(res.status).toBe(400)

    // Missing optional "limit" parameter
    const req1 = new Request('http://localhost/search?query=test', {
      headers: {
        'x-api-key': 'secret123'
      }
    })
    const res1 = await handler(req1)
    expect(res1.status).toBe(200)
  })

  it('validates response, sending invalid response and trigger error', async () => {
    const logSpy = spyOn(console, 'error')
    const handler = routes['/users']?.POST
    const req = new Request('http://localhost/users', {
      headers: {
        'x-api-key': 'secret123'
      }
    })
    const res = await handler(req)
    // createUser handler above will send an invalid response
    expect(logSpy).toHaveBeenCalledTimes(1) // strict: invalid response will invoke console.error always
    expect(res.status).toBe(500) // development: will trigger error response
  })

  it('handles CORS preflight', async () => {
    const handler = routes['/hello']?.OPTIONS
    const res = await handler(new Request('http://localhost/hello', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns 501 for unregistered operationId', async () => {
    api.register('getHello', null) // unregister
    const newRoutes = await api.routes()
    const res = await newRoutes['/hello'].GET(new Request('http://localhost/hello', {
      headers: {
        'x-api-key': 'secret123'
      }
    }))
    expect(res.status).toBe(501) 
  })

  it('returns 401 even for unregistered operationId if security fails', async () => {
    const handler = routes['/test']?.GET
    const req = new Request('http://localhost/test') // Not sending required headers
    const res = await handler(req)
    // Security validation is invoked first
    expect(res.status).toBe(401) 
  })

  // Delete temp file
  afterAll(async () => {
    await unlink('openapi.yaml')
  })

})
