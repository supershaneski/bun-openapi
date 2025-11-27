import { parse } from 'yaml'

class BunOpenAPI {
    constructor({ definition, cors }) {
        this.definition = definition          // path or object
        this.operations = new Map()           // operationId → handler
        this.securityHandlers = new Map()     // schemeName → handler
        this.spec = null

        const defaultCors = {
            "Access-Control-Allow-Origin": "*",           // default: allow all
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
        }

        if (cors) {
            // If user passes `origin` (most common), replace Allow-Origin
            if (cors.origin && cors.origin !== "*") {
                defaultCors["Access-Control-Allow-Origin"] = cors.origin
                // If origin is restricted, credentials must be true and we should validate Origin header
                defaultCors["Access-Control-Allow-Credentials"] = "true"
                delete cors.origin // don't leak into spread
            }
            // Allow full override if they want
            this.CORS_HEADERS = { ...defaultCors, ...cors }
        } else {
            this.CORS_HEADERS = defaultCors
        }
    }

    register(operationId, handler) {
        if (!operationId || typeof operationId !== "string") {
        throw new Error("operationId must be a string")
        }
        if (typeof handler !== "function") {
        throw new Error("handler must be a function")
        }
        this.operations.set(operationId, handler)
    }

    registerSecurity(schemeName, handler) {
        if (!schemeName || typeof schemeName !== "string") {
        throw new Error("schemeName must be a string")
        }
        if (typeof handler !== "function") {
        throw new Error("handler must be a function")
        }
        this.securityHandlers.set(schemeName, handler)
    }

    async routes() {
        const file = Bun.file(this.definition)
        const text = await file.text()
        const doc = parse(text)
        this.spec = doc

        const globalSecurity = doc.security || []
        const routes = {}

        // Pre-build to detect conflicts
        const pathMap = new Map() // bunPath → original OpenAPI path
        
        for (const openApiPath in doc.paths) {
            const bunPath = openApiPath.replace(/{([^}]+)}/g, ":$1")
            if (routes[bunPath] && pathMap.get(bunPath) !== openApiPath) {
                console.warn(`Route conflict! Both "${pathMap.get(bunPath)}" and "${openApiPath}" map to "${bunPath}"`)
                // You can choose to throw or prefer one
            }
            pathMap.set(bunPath, openApiPath)
        }

        for (const openApiPath in doc.paths) {
            const pathItem = doc.paths[openApiPath]
            const bunPath = openApiPath.replace(/{([^}]+)}/g, ":$1")

            if (!routes[bunPath]) routes[bunPath] = {}
            
            for (const method in pathItem) {
                if (!['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'].includes(method)) {
                    continue
                }
    
                const upper = method.toUpperCase()

                const operation = pathItem[method]
                if (!operation) continue

                const operationId = operation.operationId
                if (!operationId) {
                    console.warn(`Missing operationId on ${upper} ${bunPath}`)
                    continue
                }
    
                const effectiveSecurity = operation.security ?? globalSecurity
    
                routes[bunPath][upper] = async (req) => {
                    
                    let context

                    // This is only for running in non-Bun environments such as during test 
                    if (Object.prototype.toString.call(req) !== '[object BunRequest]') {
                        
                        const url = new URL(req.url)
                        const pathSegments = url.pathname.split('/').filter(Boolean)
                        const templateSegments = openApiPath.split('/').filter(Boolean)

                        const params = {}
                        for (let i = 0; i < templateSegments.length; i++) {
                            if (templateSegments[i].startsWith('{') && templateSegments[i].endsWith('}')) {
                                const paramName = templateSegments[i].slice(1, -1)
                                params[paramName] = pathSegments[i]
                            } else if (templateSegments[i].startsWith(':')) {
                                const paramName = templateSegments[i].slice(1)
                                params[paramName] = pathSegments[i]
                            }
                        }

                        context = {
                            method: req.method,
                            url: req.url,
                            headers: req.headers,
                            params,
                        }
                    } else {
                        context = req
                    }

                    if (effectiveSecurity && effectiveSecurity.length > 0) {
                        for (const requirement of effectiveSecurity) {
                            const schemeName = Object.keys(requirement)[0]
                            const requiredScopes = requirement[schemeName] || []
                            const authHandler = this.securityHandlers.get(schemeName)

                            if (!authHandler) {
                                console.error(`Security scheme "${schemeName}" not implemented in security handlers`)
                                return new Response(
                                    JSON.stringify({ error: 'Internal configuration error' }),
                                    { status: 500, headers: { 'Content-Type': 'application/json', ...this.CORS_HEADERS } }
                                )
                            }
    
                            try {
                                
                                const authorized = await authHandler(context, requiredScopes)

                                // If handler returns false or throws → unauthorized
                                if (authorized !== true) {
                                    if (authorized instanceof Response) return authorized
                                    return new Response(
                                        JSON.stringify({ error: 'Unauthorized' }),
                                        { status: 401, headers: { 'Content-Type': 'application/json', ...this.CORS_HEADERS } }
                                    )
                                }
                                
                            } catch (err) {
                                console.error(`Auth handler error for ${schemeName}:`, err)
                                if (err instanceof Response) return err
                                return new Response(
                                    JSON.stringify({ error: 'Forbidden' }),
                                    { status: 403, headers: { 'Content-Type': 'application/json', ...this.CORS_HEADERS } }
                                )
                            }
                        }
                    }

                    const handler = this.operations.get(operationId)
    
                    if (handler) {
                        return await handler(context)
                    }

                    return new Response(
                        JSON.stringify({
                            message: `Not implemented: ${upper} ${bunPath}`,
                        }),
                        { 
                            status: 501,
                            headers: {
                                ...this.CORS_HEADERS,
                                'Content-Type': 'application/json',
                            }
                        }
                    )
                }
            }
    
            routes[bunPath]['OPTIONS'] = async (req) => {
                return new Response('OK', { status: 204, headers: this.CORS_HEADERS })
            }
    
        }
        
        return routes
    }
}

export default BunOpenAPI