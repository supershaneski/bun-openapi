# bun-openapi

Lightweight [OpenAPI](https://swagger.io/docs/specification/v3_0/about/) router middleware for [Bun](https://bun.com/docs).

## Get Started

### Installation

```sh
# bun add @supershaneski/bun-openapi
bun add git+https://github.com/supershaneski/bun-openapi.git
```

### Quick Start

```js
import BunOpenAPI from '@supershaneski/bun-openapi'

const api = new BunOpenAPI({
  // You will need to properly locate the path for your openapi yaml file
  definition: './openapi.yaml',
  // You can override the default CORS headers, if necessary
  //cors: { origin: 'https://yoursite.com' } 
})

// Endpoint handlers
api.register('getHello', async (req) => {
  return new Response('Hello from Bun!')
})

api.register('getUser', async (req) => {
  const { id } = req.params
  return Response.json({ userId: id })
})

// Security handler
api.registerSecurity('bearerAuth', async (req) => {
  const auth = req.headers.get('Authorization')
  const token = auth?.split(' ')?.[1]
  return token === 'secret-token' || false
})

const routes = await api.routes()

Bun.serve({
  routes,
  port: 4000,
  fetch(req) {
    return new Response('Not Found', { status: 404 })
  }
})
```

```yaml
openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
paths:
  /hello:
    get:
      operationId: getHello
      security: []
      responses:
        '200':
          description: OK
  /users/:id:
    get:
      operationId: getUser
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        '200':
          description: OK
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
security: []
```

> [!Note]
> You might need to include CORS headers in the response if you are using fetch().
> ```js
> api.register('getHello', async (req) => {
>   return new Response('Hello from Bun!', { headers: { 'Access-Control-Allow-Origin': '*', ... }})
> })
>
> api.register('getUser', async (req) => {
>   const { id } = req.params
>   return Response.json({ userId: id }, { headers: { 'Access-Control-Allow-Origin': '*', ... }})
> })
> ```

## License

MIT
