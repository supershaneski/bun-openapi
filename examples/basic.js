import { randomUUID } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { CookieMap } from 'bun'

import BunOpenAPI from '../src/index'

// JWT helper functions

// Example secrets (at least 256 bits).
// In real apps, load these from environment variables.
const JWT_ACCESS_SECRET = 'ldRPY+emPI9JpXcuWhY4EsNWlaJskTJ+irDqmKuzvbM='
const JWT_REFRESH_SECRET = 'xbJU5gNMjoZmwNTMIerMCDA6A3w1wDfVaXUYRdQ8b94='

const ACCESS_EXPIRY = 900
const REFRESH_EXPIRY = 3600

const createTokens = async (payload) => {

  const now = Math.floor(Date.now() / 1000)

  payload.iat = now

  const accessSecret = new TextEncoder().encode(JWT_ACCESS_SECRET)
  const refreshSecret = new TextEncoder().encode(JWT_REFRESH_SECRET)

  const accessToken = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(now + ACCESS_EXPIRY)
    .sign(accessSecret)

  const refreshToken = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(now + REFRESH_EXPIRY)
    .sign(refreshSecret)
      
  return { accessToken, refreshToken }
}

const mapError = (err) => {
  if (err.code === 'ERR_JWT_EXPIRED') return 'TOKEN_EXPIRED'
  if (err.code?.startsWith('ERR_JWS') || err.code?.startsWith('ERR_JWT')) return 'INVALID_TOKEN'
  return 'TOKEN_ERROR'
}

// Verifies JWT and normalizes jose errors into app-level error codes
const verify = async (token, key) => {

  const accessSecret = new TextEncoder().encode(JWT_ACCESS_SECRET)
  const refreshSecret = new TextEncoder().encode(JWT_REFRESH_SECRET)

  const secret = (key === 'access') ? accessSecret : refreshSecret

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    })
    return { valid: true, payload }
  } catch (err) {
    return { valid: false, error: mapError(err) }
  }
}

const verifyAccessToken = (token) => verify(token, 'access')
const verifyRefreshToken = (token) => verify(token, 'refresh')

// Server code

let users = {
  alice: { id: 'usr1001', name: 'Alice W. Land', image: null, password: 'qwerty123' },
  john: { id: 'usr1002', name: 'John T. Smith', image: null, password: 'test123' },
}
let todos = []

const __dirname = dirname(fileURLToPath(import.meta.url))

const api = new BunOpenAPI({
  definition: `${__dirname}/openapi.yaml`,
  cors: {
    // Matches the OpenAPI security setup:
    // - JWT auth via HttpOnly cookies
    // - Double-submit CSRF protection (cookie + X-CSRF-Token header)
    // This requires an explicit origin and allowing the CSRF header.
    origin: 'http://localhost:5174', // your own client ip address and port
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
  },
  strict: true,
  development: true,
})

// Endpoint handlers
api.register('login', async (req, c) => {

  const { login, password } = await req.json()

  const user = users[login]
  if (!user || user.password !== password) {
    return Response.json({
      code: 'INVALID_LOGIN', 
      message: 'Invalid login or password'
    }, { 
      status: 401 
    })
  }
  
  const payload = { id: user.id }

  const { accessToken, refreshToken } = await createTokens(payload)

  const accessCookie = new CookieMap()
  accessCookie.set('accessToken', accessToken, {
    maxAge: ACCESS_EXPIRY,
    httpOnly: true,
    secure: false, // dev only (set true in production)
    sameSite: 'strict',
    path: '/',
  })
  const accessCookieHeader = accessCookie.toSetCookieHeaders()

  const refreshCookie = new CookieMap()
  refreshCookie.set('refreshToken', refreshToken, {
    maxAge: REFRESH_EXPIRY,
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    path: '/api/refresh',
  })
  const refreshCookieHeader = refreshCookie.toSetCookieHeaders()

  const csrfToken = randomUUID()

  const csrfCookie = new CookieMap()
  csrfCookie.set('csrfToken', csrfToken, {
    maxAge: REFRESH_EXPIRY,
    httpOnly: false, // must be readable by the client for double-submit CSRF
    sameSite: 'lax',
    secure: false,
    path: '/',
  })
  const csrfCookieHeader = csrfCookie.toSetCookieHeaders()

  // Cookies must be appended individually; otherwise only one will be sent
  // See issue for reference: https://github.com/oven-sh/bun/issues/7383#issuecomment-2316464883
  const headers = new Headers()
  headers.append('Set-Cookie', accessCookieHeader)
  headers.append('Set-Cookie', refreshCookieHeader)
  headers.append('Set-Cookie', csrfCookieHeader)
  headers.append('Content-Type', 'application/json')

  return Response.json({
    created: Date.now(),
    status: 'success',
    data: {
      name: user.name,
      image: user.image,
    }
  }, {
    status: 200,
    headers,
  })

})

api.register('logout', async (req, c) => {

  const accessCookie = new CookieMap()
  accessCookie.set('accessToken', null, {
    maxAge: 0,
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    path: '/',
  })
  const accessCookieHeader = accessCookie.toSetCookieHeaders()

  const refreshCookie = new CookieMap()
  refreshCookie.set('refreshToken', null, {
    maxAge: 0,
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    path: '/api/refresh',
  })
  const refreshCookieHeader = refreshCookie.toSetCookieHeaders()

  const csrfCookie = new CookieMap()
  csrfCookie.set('csrfToken', null, {
    maxAge: 0,
    httpOnly: false,
    sameSite: 'lax',
    secure: false,
    path: '/',
  })
  const csrfCookieHeader = csrfCookie.toSetCookieHeaders()

  const headers = new Headers()
  headers.append('Set-Cookie', accessCookieHeader)
  headers.append('Set-Cookie', refreshCookieHeader)
  headers.append('Set-Cookie', csrfCookieHeader)

  // 204 must not have a body
  return new Response(null, {
    status: 204,
    headers,
  })
})

api.register('refresh', async (req, c) => {
  let user = c.user

  const payload = {
    id: user.id
  }

  const { accessToken, refreshToken } = await createTokens(payload)

  const accessCookie = new CookieMap()
  accessCookie.set('accessToken', accessToken, {
    maxAge: ACCESS_EXPIRY,
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    path: '/',
  })
  const accessCookieHeader = accessCookie.toSetCookieHeaders()

  const refreshCookie = new CookieMap()
  refreshCookie.set('refreshToken', refreshToken, {
    maxAge: REFRESH_EXPIRY,
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    path: '/api/refresh',
  })
  const refreshCookieHeader = refreshCookie.toSetCookieHeaders()

  const csrfToken = randomUUID()

  const csrfCookie = new CookieMap()
  csrfCookie.set('csrfToken', csrfToken, {
    maxAge: REFRESH_EXPIRY,
    httpOnly: false,
    sameSite: 'lax',
    secure: false,
    path: '/',
  })
  const csrfCookieHeader = csrfCookie.toSetCookieHeaders()

  const headers = new Headers()
  headers.append('Set-Cookie', accessCookieHeader)
  headers.append('Set-Cookie', refreshCookieHeader)
  headers.append('Set-Cookie', csrfCookieHeader)
  headers.append('Content-Type', 'application/json')

  return Response.json({
    created: Date.now(),
    status: 'success',
  }, {
    status: 200,
    headers,
  })
})

api.register('updateProfile', async (req, c) => {
  let user = c.user

  const form = await req.formData()
  const name = form.get('name')
  const file = form.get('image')
  const removeImageRaw = form.get('removeImage')

  const removeImage = removeImageRaw === 'true' || removeImageRaw === '1'

  if (name) {
    user.name = name
  }

  if (file instanceof File) {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const base64 = buffer.toString('base64')
    user.image = `data:${file.type};base64,${base64}`
  }

  if (removeImage) {
    user.image = null
  }

  return Response.json({
    created: Date.now(),
    status: 'success',
    data: {
      name: user.name,
      image: user.image
    }
  })
})

api.register('getTodoList', async (req, c) => {
  let user = c.user

  // Filter todos by owner and omit the `owner` field from the response
  const myTodos = todos.filter((t) => t.owner === user.id)
    .map((t) => {
      const { owner, ...others } = t
      return others
    })

  return Response.json({
    created: Date.now(),
    status: 'success',
    data: myTodos
  })
})

api.register('addTodo', async (req, c) => {
  let user = c.user

  const { title } = await req.json()
  if (!title) {
    return Response.json({
      code: 'INVALID_PARAM',
      message: 'Invalid parameter'
    }, {
      status: 400
    })
  }

  const newTodo = {
    id: randomUUID(),
    title,
    date: new Date().toISOString(),
  }

  todos.push({ ...newTodo, owner: user.id })

  return Response.json({
    created: Date.now(),
    status: 'success',
    data: newTodo
  }, {
    status: 201,
  })
})

api.register('getTodo', async (req, c) => {
  const { id } = req.params // request path parameter
  
  let user = c.user
  
  const todo = todos.find((t) => t.id === id && t.owner === user.id)
  if (!todo) {
    return Response.json({
      code: 'NOT_FOUND',
      message: 'Item not found'
    }, {
      status: 404
    })
  }

  const { owner, ...filtered } = todo

  return Response.json({
    created: Date.now(),
    status: 'success',
    data: filtered
  })
})

api.register('deleteTodo', async (req, c) => {
  const { id } = req.params // request path parameter
  
  let user = c.user
  
  const index = todos.findIndex((t) => t.id === id && t.owner === user.id)
  if (index === -1) {
    return Response.json({
      code: 'NOT_FOUND',
      message: 'Item not found'
    }, {
      status: 404
    })
  }

  return Response.json(null, {
    status: 204
  })
})

api.register('getPrivacy', async (req, c) => {
  const privacy = `# Privacy Policy
    This is a temporary privacy policy used as a placeholder until the finalized version is provided.
    ## Introduction
    This web application (*Service*) collects and handles certain information to operate effectively...`
  
  return new Response(privacy, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown'
    }
  })
})

api.register('getStream', async (req, c) => {
  
  // Simulate streaming using Server-Sent Events (SSE) by emitting one character at a time
  const text = `Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ` 

  const stream = new ReadableStream({
    type: 'direct',
    pull: async (controller) => {
      for (const char of text) {
        controller.write(`data: ${char}\n\n`) // SSE format
        await controller.flush()
        await Bun.sleep(50) // optional, simulate pause
      }
      controller.close()
    }
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    }
  })
})

// Security handlers
api.registerSecurity('CookieAuth', async (req, scopes, c) => {
  const token = req.cookies.get('accessToken')
  if (!token) return false

  const result = await verifyAccessToken(token)
  if (!result.valid) return false
  
  const id = result.payload?.id
  if (!id) return false

  let user
  for (const key in users) {
    if (users[key].id === id) {
      user = users[key]
      break
    }
  }

  if (!user) return false

  c.user = user // passing user

  return true
})

api.registerSecurity('RefreshCookieAuth', async (req, requiredScopes, c) => {
  const token = req.cookies.get('refreshToken')
  if (!token) return false

  const result = await verifyRefreshToken(token)
  if (!result.valid) return false
  
  const id = result.payload?.id
  if (!id) return false

  let user
  for (const key in users) {
    if (users[key].id === id) {
      user = users[key]
      break
    }
  }

  if (!user) return false

  c.user = user // passing user

  return true  
})

api.registerSecurity('CSRFCookieAuth', async (req, requiredScopes, c) => {
  const token = req.cookies.get('csrfToken')
  if (!token) return false

  c.csrfToken = token // passing CSRF token

  return true
})

api.registerSecurity('CSRFHeaderAuth', async (req, requiredScopes, c) => {
  const token = req.headers.get('x-csrf-token')
  if (!token) return false

  // The order of the security schemes matters as defined in the OpenAPI spec.
  // That’s why the comparison is done here.
  return c.csrfToken === token
})

// Error handler
api.registerErrorHandler((error) => {
  const payload = {
    created: Date.now(),
    status: 'error',
    code: error.code,
    message: error.message,
  }
  return Response.json(payload, { status: error.status })
})

// Not found handler
api.registerNotFound((req) => {
  const path = new URL(req.url).pathname
  const message = `The resource ${req.method} ${path} is not found.`
  const payload = {
    created: Date.now(),
    status: 'error',
    code: 'NOT_FOUND',
    message
  }
  return Response.json(payload, { status: 404 })
})

const routes = await api.routes()

const server = Bun.serve({
  routes,
  port: 3000,
})

console.log(`Server started and listening on port ${server.port}`)
