import { parse } from 'yaml'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

/**
 * @file This file contains the definition of the BunOpenAPI class, a middleware router for Bun.
 * @module BunOpenAPI
 * @class
 * @classdesc BunOpenAPI is a middleware router designed for Bun, offering **request and response validation** based on an OpenAPI 3.x specification.
 * @author supershaneski <@supershaneski>
 * @license MIT
 */
class BunOpenAPI {

    /**
     * @typedef {object} CorsOptions
     * @property {string} [origin='*'] - The value for the Access-Control-Allow-Origin header.
     * @property {string} [Access-Control-Allow-Methods] - Comma-separated list of allowed methods.
     * @property {string} [Access-Control-Allow-Headers] - Comma-separated list of allowed headers.
     * // ... other custom CORS headers
     */

    /**
     * Creates an instance of BunOpenAPI.
     * @param {object} options - Configuration options for the middleware.
     * @param {string|object} options.definition - Filepath of the OpenAPI yaml/json schema (string) or the parsed OpenAPI object (object).
     * @param {CorsOptions|object} [options.cors] - Overrides or extends default CORS headers.
     * @param {boolean} [options.strict=false] - Enables **response validation** against the schema.
     * @param {boolean} [options.development=true] - Shows detailed validation errors in error responses.
     */
    constructor({ 
        definition, 
        cors,
        strict = false, // Response validation
        development = true, // Detailed error message
    }) {
        this.definition = definition          // path or object
        this.operations = new Map()           // operationId → handler
        this.securityHandlers = new Map()     // schemeName → handler
        this.spec = null

        this.strictResponseValidation = strict
        this.development = development

        this._errorHandler = null
        this._notFoundHandler = null

        // strict: false (OpenAPI has extra keywords Ajv doesn't know)
        // coerceTypes: true (converts ?limit=10 string to integer)
        this.ajv = new Ajv({ strict: false, coerceTypes: true, allErrors: true })
        addFormats(this.ajv)
        
        // Accept File for "string"/"binary"
        this.ajv.addFormat('binary', {
            type: 'string',
            validate: (value) => value instanceof File
        })

        // Add base64
        this.ajv.addFormat('base64', {
            type: 'string',
            validate: (str) => {
                let raw = str
                // support "data:*;base64,xxx"
                const comma = str.indexOf(',')
                if (comma !== -1) raw = str.slice(comma + 1)
                // strict base64 characters + optional padding
                if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return false
                try {
                    atob(raw)
                    return true
                } catch {
                    return false
                }
            }
        })

        const defaultCors = {
            //'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            //'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-CSRF-TOKEN',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }

        if (cors) {
            /*const userCors = { ...cors }
            if ('origin' in userCors) {
                defaultCors['Access-Control-Allow-Origin'] = cors.origin
                defaultCors['Access-Control-Allow-Credentials'] = 'true'
                delete userCors.origin
            }*/

            if (cors.origin === '*') {
                // Safe wildcard mode
                defaultCors['Access-Control-Allow-Origin'] = '*'
            } else if (cors.origin) {
                // Specific origin(s) — support credentials
                defaultCors['Access-Control-Allow-Origin'] = cors.origin
                defaultCors['Access-Control-Allow-Credentials'] = 'true'
                defaultCors['Vary'] = 'Origin'
            } else {
                // No origin specified → inherit wildcard
                defaultCors['Access-Control-Allow-Origin'] = '*'
            }

            // Allow full override if they want
            this.CORS_HEADERS = { ...defaultCors, ...cors }
        } else {
            this.CORS_HEADERS = {
                'Access-Control-Allow-Origin': '*',
                ...defaultCors
            }
        }
    }

    /**
     * Registers the main handler function for an OpenAPI operationId.
     * @param {string} operationId - The unique `operationId` from the OpenAPI schema.
     * @param {function(object, object): (Response|Promise<Response>)} handler - The asynchronous function callback to handle the request.
     * The function receives `context` (request data) and `securityContext` (auth data). Use `null` to unregister.
     */
    register(operationId, handler) {
        if (!operationId || typeof operationId !== 'string') {
            throw new Error('operationId must be a string')
        }
        if (handler !== null && typeof handler !== 'function') {
            throw new Error('handler must be a function or null')
        }
        if (handler === null) {
            this.operations.delete(operationId)
        } else {
            this.operations.set(operationId, handler)
        }
    }

    /**
     * Registers a handler function for an OpenAPI Security Scheme.
     * @param {string} schemeName - The name of the security scheme (e.g., 'BearerAuth', 'apiKey').
     * @param {function(object, string[], object): (boolean|Response|Promise<boolean|Response>)} handler - The asynchronous function callback for authorization.
     * Returns `true` for success, a `Response` object for custom errors (e.g., 401), or `false` for default 401/403.
     */
    registerSecurity(schemeName, handler) {
        if (!schemeName || typeof schemeName !== 'string') {
            throw new Error('schemeName must be a string')
        }
        if (handler !== null && typeof handler !== 'function') {
            throw new Error('handler must be a function or null')
        }
        if (handler === null) {
            this.securityHandlers.delete(schemeName)
        } else {
            this.securityHandlers.set(schemeName, handler)
        }
    }

    /**
     * Registers a custom handler for internal framework errors (e.g., validation failures, 500s).
     * @param {function(object): (object|Response|Promise<object|Response>)} handler - The function callback to format the error response body.
     * Receives an error object `{status, code, message, details}`.
     * Can return a custom plain object (which will be JSON-wrapped) or a Bun `Response` object.
     */
    registerErrorHandler(handler) {
        if (typeof handler === 'function') {
            this._errorHandler = handler
        }
    }

    /**
     * Registers a custom global handler for 404 Not Found responses when no route matches.
     * @param {function(Request, RequestContext): (Response|object|Promise<Response|object>)} [handler]
     *   Optional handler function invoked on unmatched routes.
     *   Receives the original `Request`.
     * @param {null} [handler=null] Pass `null` to unregister a previously set handler.
     */
    registerNotFound(handler) {
        if (typeof handler === 'function' || handler === null) {
            this._notFoundHandler = handler
        }
    }

    /**
     * Loads the OpenAPI definition, compiles validators, and returns a routing object map
     * compatible with Bun's `Bun.serve` or a similar router.
     * @async
     * @returns {Promise<object<string, object<string, function(Request): Promise<Response>>>>} An object mapping Bun paths to an object of HTTP methods and their Bun handler functions.
     * @throws {Error} If the OpenAPI definition file cannot be read or is invalid.
     */
    async routes() {
        let doc

        if (typeof this.definition === 'string') {
            const filePath = path.resolve(this.definition) // Resolve the path
            try {
                // Read the file asynchronously. 'utf8' ensures text decoding.
                const text = await readFile(filePath, 'utf8')
                doc = parse(text)
            } catch (error) {
                console.error(`Error reading or parsing OpenAPI definition file: ${filePath}`, error)
                throw new Error(`Failed to load OpenAPI definition: ${error.message}`)
            }
        } else if (typeof this.definition === 'object' && this.definition !== null) {
            // If the definition is passed as an object, use it directly
            doc = this.definition
        } else {
            throw new Error('Invalid definition provided. Must be a file path (string) or an OpenAPI object.')
        }

        this.spec = doc

        // Get the map of all defined schemas (where Ajv needs to look for $refs)
        const componentSchemas = doc.components?.schemas
        if (componentSchemas) {
            // Add each schema individually to Ajv, using the key as the schema ID.
            for (const schemaName in componentSchemas) {
                const schema = componentSchemas[schemaName]
                const patched = this._rewriteRefs({ ...schema })
                this._patchBinaryTypes(patched)
                this.ajv.addSchema(patched, schemaName)
            }
        }

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

                // Pre-compile validators for this specific route
                const validators = this._compileValidators(operation)
    
                const effectiveSecurity = operation.security ?? globalSecurity
    
                routes[bunPath][upper] = async (req) => {
                    
                    // Extract params
                    let params = req.params || {}

                    // Fallback path parameter extraction if req.params is not populated by the outer router
                    if (Object.keys(params).length === 0) {

                        const url = new URL(req.url)
                        const pathSegments = url.pathname.split('/').filter(Boolean)
                        const templateSegments = openApiPath.split('/').filter(Boolean)

                        params = {}
                        for (let i = 0; i < templateSegments.length; i++) {
                            if (templateSegments[i].startsWith('{') && templateSegments[i].endsWith('}')) {
                                const paramName = templateSegments[i].slice(1, -1)
                                params[paramName] = pathSegments[i]
                            } else if (templateSegments[i].startsWith(':')) {
                                const paramName = templateSegments[i].slice(1)
                                params[paramName] = pathSegments[i]
                            }
                        }
                    }

                    const securityContext = {}
                    const context = {
                        // Attach common Request properties
                        headers: req.headers,
                        url: req.url,
                        method: req.method,
                        
                        // Path Parameters
                        params: params,
                        
                        // Query Parameters
                        query: {},
                        
                        // Body
                        body: null,
                        
                        // Cookies
                        cookies: {}
                    }

                    // Parse Query Parameters
                    const url = new URL(req.url)
                    const queryParams = Object.fromEntries(url.searchParams.entries())
                    context.query = queryParams

                    // Parse Cookies
                    context.cookies = this._parseCookies(req)

                    // A. Validate Query Parameters
                    if (validators.query) {
                        const valid = validators.query(queryParams)
                        if (!valid) {
                            return this._createErrorResponse(400, 'ERR_VALIDATION', 'Query validation failed', validators.query.errors)
                        }
                    }
                    // B. Validate Path Parameters
                    // (Bun puts path params in req.params, but we need to check if they match schema)
                    if (validators.path && context.params) {
                        const valid = validators.path(context.params)
                        if (!valid) {
                            return this._createErrorResponse(400, 'ERR_VALIDATION', 'Path validation failed', validators.path.errors)
                        }
                    }
                    // C. Validate Body
                    let parsedBody = null
                    if (validators.body) {

                        const contentType = req.headers.get('Content-Type') || ''
                        
                        try {

                            if (contentType.includes('application/json')) {
                                parsedBody = await req.json()
                            } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
                                
                                const formData = await req.formData()
                                // Convert Bun's FormData (an iterable) into a standard key-value object 
                                // that Ajv can validate. Files are usually Bun.file objects.
                                parsedBody = {}
                                for (const [key, value] of formData.entries()) {
                                    if (key in parsedBody) {
                                        if (!Array.isArray(parsedBody[key])) {
                                            parsedBody[key] = [parsedBody[key]] // For multiple files, same field
                                        }
                                        parsedBody[key].push(value)
                                    } else {
                                        parsedBody[key] = value
                                    }
                                }
                                
                            } else {
                                // If a body schema exists but Content-Type is unknown, reject the request.
                                return this._createErrorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported Content-Type header.')
                            }

                        } catch (e) {
                            parsedBody = {} // Allow empty body (all items optional/not required)
                        }

                        const valid = validators.body(parsedBody)
                        if (!valid) {
                            return this._createErrorResponse(400, 'INVALID_BODY_VALIDATION', 'Body validation failed', validators.body.errors)
                        }

                    }

                    // Security Checks
                    if (effectiveSecurity && effectiveSecurity.length > 0) {
                        
                        for (const requirement of effectiveSecurity) {
                            const schemeName = Object.keys(requirement)[0]
                            const requiredScopes = requirement[schemeName] || []
                            const authHandler = this.securityHandlers.get(schemeName)

                            if (!authHandler) {
                                console.error(`Security scheme "${schemeName}" not implemented in security handlers`)
                                return this._createErrorResponse(500, 'ERR_CONFIG', 'Internal configuration error')
                            }
    
                            try {
                                
                                const authorized = await authHandler(context, requiredScopes, securityContext)

                                // If handler returns false or throws → unauthorized
                                if (authorized !== true) {
                                    if (authorized instanceof Response) return authorized
                                    return this._createErrorResponse(401, 'UNAUTHORIZED', 'Unauthorized')
                                }
                                
                            } catch (err) {
                                console.error(`Auth handler error for ${schemeName}:`, err)
                                if (err instanceof Response) return err
                                return this._createErrorResponse(403, 'FORBIDDEN', 'Forbidden')
                            }
                        }
                    }

                    // Actual handler
                    const handler = this.operations.get(operationId)

                    if (handler) {
                        if (parsedBody) {

                            const contentType = req.headers.get('Content-Type') || ''

                            context.body = parsedBody

                            if (contentType.includes('application/json')) {
                                context.json = async () => parsedBody
                            } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
                                context.formData = async () => {
                                    const form = new FormData()
                                    for (const key in parsedBody) {
                                        if (Array.isArray(parsedBody[key])) {
                                            // This is to handle multiple files upload
                                            for (let i = 0; i < parsedBody[key].length; i++) {
                                                form.append(key, parsedBody[key][i])
                                            }
                                        } else {
                                            form.append(key, parsedBody[key])
                                        }
                                    }
                                    return form
                                }
                            }
                            
                        }

                        try {

                            const response = await handler(context, securityContext)

                            const contentType = response.headers.get('content-type')
                            const isSSE = contentType && contentType.startsWith('text/event-stream')

                            // Strict: Validate response
                            if (this.strictResponseValidation && validators.responses.size > 0 && !isSSE) {
                                
                                const statusCode = response.status.toString()
                                const validator = validators.responses.get(statusCode)

                                if (validator === undefined) {
                                    console.warn(`Response Validation Warning: Status ${statusCode} is not documented for ${operationId}.`)
                                } else {
                                    let responseData = null
                                    const contentType = response.headers.get('content-type') || ''

                                    if (contentType.includes('application/json')) {
                                        try {
                                            // Clone the response before reading the stream
                                            responseData = await response.clone().json()
                                        } catch(e) {
                                            responseData = null
                                        }
                                    }

                                    if (responseData) {
                                        if (validator === null) {
                                            console.warn(`Response Validation Warning: Status ${statusCode} does not expect body for ${operationId}.`)
                                        } else {

                                            if (statusCode === '204' || statusCode === '304') {
                                                console.warn(`Response Validation Warning: Attempted to return body on status ${statusCode} for ${operationId}.`)
                                            }

                                            const valid = validator(responseData)
                                            if (!valid) {
                                                // Developer Error: Log the failure prominently
                                                const details = validator.errors || []
                                                const errMessage = `Response Validation Warning: Status ${statusCode} for ${operationId} failed validation against OpenAPI schema.`
                                                
                                                console.error(errMessage, details)
                                                
                                                // In production with strict: true but production: just log, don't break client
                                                if (this.development) {
                                                    return this._createErrorResponse(500, 'CONTRACT_VIOLATION', errMessage, details)
                                                }
                                                
                                            }
                                        }
                                    } else {
                                        if (validator) {
                                            console.warn(`Response Validation Warning: Status ${statusCode} expected body for ${operationId} but did not found.`)
                                        }
                                    }

                                }
                            }

                            // Attach cors headers
                            for (const [key, value] of Object.entries(this.CORS_HEADERS)) {
                                response.headers.set(key, value)
                            }
                            
                            return response

                        } catch(err) {
                            console.error(`Unhandled error in handler ${operationId}:`, err)
                            return this._createErrorResponse(500, 'HANDLER_ERROR', 'Internal handler error')
                        }

                    }

                    // Handle not implemented
                    return this._createErrorResponse(501, 'NOT_IMPLEMENTED', `Not implemented: ${upper} ${bunPath}`)
                }
            }
            
            // Handle preflight
            routes[bunPath]['OPTIONS'] = async (req) => {
                return new Response(null, { 
                    status: 204, 
                    headers: this.CORS_HEADERS 
                })
            }
    
        }

        // Add Global handler for 404 Not Found
        routes['/*'] = async (req) => {

            if (this._notFoundHandler) {
                try {

                    const formatted = await this._notFoundHandler(req)
                
                    if (formatted instanceof Response) {
                        // Attach cors headers
                        for (const [key, value] of Object.entries(this.CORS_HEADERS)) {
                            formatted.headers.set(key, value)
                        }

                        return formatted
                    }

                    if (typeof formatted === 'object' && formatted !== null) {
                        return Response.json(formatted, {
                            status: 404,
                            headers: {
                                ...this.CORS_HEADERS,
                                'Content-Type': 'application/json'
                            }
                        })
                    }

                } catch(err) {
                    console.error(`Unhandled error in NOT_FOUND handler:`, err)
                    return this._createErrorResponse(500, 'HANDLER_ERROR', 'Internal handler error')
                }

            }

            return new Response('Not Found', { 
                status: 404, 
                headers: this.CORS_HEADERS 
            })
        }

        return routes
    }

    // Helper to create error response
    async _createErrorResponse(
        status = 500, 
        code = 'SERVER_ERROR', 
        message = 'An unexpected error occurred', 
        details = []
    ) {
        const safeDetails = this.development
            ? details
            : details.map(e => ({
                message: e.message,
                keyword: e.keyword,
                // omit dataPath, params, etc.
            }))
        
        if (this._errorHandler) {
            try {

                const formatted = await this._errorHandler({
                    status,
                    code,
                    message,
                    details: safeDetails
                })

                if (formatted instanceof Response) {

                    // Attach cors headers
                    for (const [key, value] of Object.entries(this.CORS_HEADERS)) {
                        formatted.headers.set(key, value)
                    }

                    return formatted
                }

                if (typeof formatted === 'object' && formatted !== null) {
                    return Response.json(formatted, {
                        status,
                        headers: {
                            ...this.CORS_HEADERS,
                            'Content-Type': 'application/json'
                        }
                    })
                }

            } catch(err) {
                console.error('Custom error handler threw an error. Falling back to default error response.', err)
            }
        }
        
        const isVerbose = this.development && details.length > 0
        
        const body = {
            code,
            message,
            ...(isVerbose ? { details: safeDetails } : {})
        }

        if (!isVerbose && status >= 400) {
            delete body.code

            if (status === 401) {
                body.message = 'Authentication required or token is invalid.'
            } else if (status === 403) {
                body.message = 'You are forbidden from accessing this resource.'
            } else if (status === 404) {
                body.message = 'Resource not found.'
            } else if (status < 500) { 
                // All other 4xx (400, 405, etc.) validation/input errors
                body.message = 'The request data is invalid or missing required parameters.'
            } else {
                // 5xx errors
                body.message = 'An unexpected server error occurred.'
            }
        }

        return Response.json(body, {
            status,
            headers: {
                ...this.CORS_HEADERS,
                'Content-Type': 'application/json',
            }
        })

    }

    // Helper to compile validation functions
    _compileValidators(operation) {
        const validators = { query: null, path: null, body: null, responses: new Map() }

        if (operation.requestBody && operation.requestBody.content) {
            let schema = null
            let isMultiPart = false // Additional processing needed if file upload

            // 1. Check for JSON (Standard API body)
            schema = operation.requestBody.content['application/json']?.schema;
            
            // 2. Check for Form Data (Files/multipart/x-www-form-urlencoded)
            if (!schema) {
                schema = operation.requestBody.content['multipart/form-data']?.schema;
                isMultiPart = true
            }
            if (!schema) {
                schema = operation.requestBody.content['application/x-www-form-urlencoded']?.schema;
            }

            if (schema) {
                if (schema['$ref']) {
                    const schemaKey = schema['$ref'].split('/').pop();
                    const compiled = this.ajv.getSchema(schemaKey)
                    if (compiled) {
                        validators.body = compiled
                    } else {
                        console.warn(`Referenced schema ${schemaKey} not found in components.schemas`)
                    }
                } else {
                    if (isMultiPart) {
                        this._patchBinaryTypes(schema)
                    }
                    validators.body = this.ajv.compile(schema)
                }
            }
            
        }

        if (operation.parameters && operation.parameters.length > 0) {
            // Group params by type (query vs path)
            const queryParams = operation.parameters.filter(p => p.in === 'query')
            const pathParams = operation.parameters.filter(p => p.in === 'path')

            if (queryParams.length > 0) {
                const schema = this._convertParamsToSchema(queryParams)
                validators.query = this.ajv.compile(schema)
            }

            if (pathParams.length > 0) {
                const schema = this._convertParamsToSchema(pathParams)
                validators.path = this.ajv.compile(schema)
            }
        }

        // Compile Response Validators
        if (operation.responses) {
            for (const statusCode in operation.responses) {
                const response = operation.responses[statusCode]
                const responseSchema = response?.content?.['application/json']?.schema

                if (responseSchema) {
                    
                    if (statusCode === '204' || statusCode === '304') {
                        console.warn(`Invalid OpenAPI Spec Warning: Status ${statusCode} should not have content field in operation ${operation.operationId}.`)
                    }

                    let validator
                    if (responseSchema['$ref']) {
                        const schemaKey = responseSchema['$ref'].split('/').pop()
                        // Try to get compiled schema from Ajv registry
                        validator = this.ajv.getSchema(schemaKey)
                    } else {
                        // Compile inline schema
                        validator = this.ajv.compile(responseSchema)
                    }
                    
                    if (validator) {
                        validators.responses.set(statusCode, validator)
                    } else {
                        console.warn(`Could not compile response schema for ${operation.operationId} (Status ${statusCode}). Schema not found in components.`)
                        validators.responses.set(statusCode, null)
                    }

                } else {
                    // Assuming other Content-Type aside from application/json
                    validators.responses.set(statusCode, null)
                }
            }
        }
        
        return validators

    }

    // Parse cookies
    _parseCookies(req) {
        const cookieHeader = req.headers.get('cookie') || req.headers.get('Cookie')
        if (!cookieHeader) return new Bun.CookieMap()
        
        const map = new Bun.CookieMap()
        if (cookieHeader) {
            cookieHeader.split(';').forEach(cookie => {
            const [name, ...rest] = cookie.trim().split('=')
            if (rest.length > 0) {
                const value = decodeURIComponent(rest.join('='))
                map.set(name, value)
            }
            })
        }
        return map
    }

    // Helper to turn OpenAPI parameter array into JSON Schema object
    _convertParamsToSchema(params) {
        const schema = {
            type: 'object',
            required: [],
            properties: {},
            additionalProperties: true, // Allow extra query params
        }

        for (const param of params) {
            if (param.required) {
                schema.required.push(param.name)
            }
            // OpenAPI param schema sits inside `schema` property
            schema.properties[param.name] = param.schema || {}
        }

        return schema
    }

    // Extract ref keyword
    _rewriteRefs(node) {
        if (node && typeof node === 'object') {
            if (node.$ref) {
                node.$ref = node.$ref.split('/').pop()
            }
            for (const v of Object.values(node)) {
                this._rewriteRefs(v)
            }
        }
        return node
    }

    // Work-around to handle File type
    _patchBinaryTypes(schema) {
        if (!schema || typeof schema !== 'object') return

        if (schema.type === 'string' && schema.format === 'binary') {
            schema.type = ['string', 'object'] // allow File
        }

        if  (schema.type === 'array' && schema.items.type === 'string' && schema.items.format === 'binary') {
            schema.type = ['array', 'object'] // multiple Files
        }

        for (const key in schema.properties || {}) {
            this._patchBinaryTypes(schema.properties[key])
        }
    }

}

export default BunOpenAPI