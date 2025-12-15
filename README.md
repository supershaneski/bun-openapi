# bun-openapi

[![bun](https://img.shields.io/badge/bun-%2315292a.svg?logo=bun)](https://bun.sh)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![npm](https://img.shields.io/npm/v/@supershaneski/bun-openapi.svg)](https://www.npmjs.com/package/@supershaneski/bun-openapi)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)


Lightweight [OpenAPI](https://swagger.io/docs/specification/v3_0/about/) router middleware for [Bun](https://bun.com/docs). Routes are generated from your OpenAPI spec and mapped using `operationId`.


## Features

- Automatic route generation from your OpenAPI spec
- Full **request validation** (path, query, headers, body)
- Optional **response validation** (`strict: true`)
- Built-in **CORS** handling
- Support for `multipart/form-data` and `File` uploads (even multiple file uploads)
- Pluggable **security scheme handlers** (Bearer, API keys, cookies, custom)
- Custom error & 404 handlers


## Get Started

### Installation

```sh
bun add @supershaneski/bun-openapi
```

### Quick Start

First, design your API server spec using an OpenAPI schema.

For guidance on designing an API using OpenAPI, check the [official documentation](https://swagger.io/docs/specification/v3_0/basic-structure/).


```yaml
openapi: 3.1.0
info:
  title: Sample API server
  version: 1.0.0
paths:
  /hello:
    get:
      operationId: getHello
      security: []
      responses:
        '200':
          description: Hello
        '500':
          description: Server error
  /users/{id}:
    get:
      operationId: getUser
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '400':
          description: Bad request
        '401':
          description: Unauthorized
        '500':
          description: Server error
    delete:
      operationId: deleteUser
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      responses:
        '200':
          description: Deleted
        '400':
          description: Bad request
        '401':
          description: Unauthorized
        '500':
          description: Server error
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    User:
      type: object
      properties:
        id:
          type: integer
        name:
          type: string
      required:
        - id
        - name
security: []
```

```js
import BunOpenAPI from '@supershaneski/bun-openapi'

// You will need to properly locate the path for your openapi yaml file
const filepath = './openapi.yaml'

const api = new BunOpenAPI({
  definition: filepath,
  strict: true,           // enables response validation
  development: true       // enables detailed error response
})

// Endpoint handlers
api.register('getHello', async (req) => {
  return new Response('Hello from Bun!')
})

api.register('getUser', async (req) => {
  const { id } = req.params
  if (id === 123) {
    // This will trigger response validation error since we did not define any 404 response.
    // When "strict" mode is enabled, responses are validated against your OpenAPI spec.
    // This helps catch mismatched status codes or response shapes early during development.
    return new Response('Not found', { status: 404 })
  }
  return Response.json({ id: id, name: 'Jonathan Smith' })
})

api.register('deleteUser', async (req) => {
  const { id } = req.params
  if (typeof id !== 'number') {
    // This code will not be reached as "id" is coerced as an integer based on the spec
    return new Response('Invalid request', { status: 400 })
  }
  return Response(null, { status: 204 })
})

// Security handler
api.registerSecurity('bearerAuth', async (req) => {
  const auth = req.headers.get('Authorization')
  const token = auth?.split(' ')?.[1] // e.g. 'Authorization': 'Bearer secret-token'
  return token === 'secret-token' || false
})

// Not found handler
api.registerNotFound((req) => {
  const path = new URL(req.url).pathname
  return new Response(`The resource ${req.method} ${path} is not found.`, { status: 404 })
})

const routes = await api.routes()

const server = Bun.serve({
  routes,
  port: 3000
})

console.log(`Server started and listening on port ${server.port}`)
```

Check the [examples](/examples/basic.js) directory for more usage patterns.


## Roadmap

* Improve schema handling over time, especially better `$ref` support. For now, schemas referenced using `$ref` are expected to live under `components/schemas`.
* Use response `examples` when available (for example, returning them automatically if a path isn’t implemented yet).


## License

MIT
