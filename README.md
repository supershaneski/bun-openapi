# @supershaneski/openapi

Lightweight OpenAPI → Bun router.

Write your OpenAPI spec → register handlers by `operationId` → get a fully working Bun server with security, path params, CORS, and validation-ready structure.

## Install

```sh
# bun add @supershaneski/openapi
bun add git+https://github.com/supershaneski/bun-openapi.git
```

## Example

```js
import BunOpenAPI from '@supershaneski/openapi'

const api = new BunOpenAPI({
  definition: './openapi.yaml',
  cors: { origin: 'https://yoursite.com' }
})

api.register('getUser', async (c) => {
  return Response.json({ id: c.params.id, name: 'Lima' })
})

api.registerSecurity('bearerAuth', async (c) => {
  const token = c.headers.authorization?.split(' ')?.[1]
  return token === 'secret' || false
})

const routes = await api.routes()

Bun.serve({
  port: 4000,
  fetch(req) {
    const url = new URL(req.url)
    const handler = routes[url.pathname]?.[req.method] ?? routes['/404']?.GET
    return handler ? handler(req) : new Response('Not Found', { status: 404 })
  }
})
```

## License

MIT
