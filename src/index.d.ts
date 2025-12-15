/// <reference types="bun" />

/**
 * Options for configuring BunOpenAPI.
 */
export interface BunOpenAPIOptions {
  /** Path to OpenAPI YAML/JSON file or parsed OpenAPI document object */
  definition: string | object;

  /** CORS configuration. Overrides or extends default headers. */
  cors?: {
    origin?: string;
    [header: string]: string | undefined;
  };

  /** Enable strict response validation against the OpenAPI schema (default: false) */
  strict?: boolean;

  /** Show detailed validation errors in responses (default: true) */
  development?: boolean;
}

/**
 * Request context passed to operation handlers.
 */
export interface RequestContext {
  /** Raw headers from the Request */
  headers: Headers;

  /** Full URL string */
  url: string;

  /** HTTP method */
  method: string;

  /** Path parameters (e.g., { id: "123" }) */
  params: Record<string, string>;

  /** Parsed query parameters */
  query: Record<string, string | string[]>;

  /** Parsed body (JSON or form data). Available after parsing. */
  body: any;

  /** Parsed cookies as a Bun.CookieMap */
  cookies: Bun.CookieMap;

  /** Convenience: re-parse body as JSON (only if Content-Type is application/json) */
  json?: () => Promise<any>;

  /** Convenience: re-create FormData (only for multipart/form-data or urlencoded) */
  formData?: () => Promise<FormData>;
}

/**
 * Security context built by security handlers.
 * You can attach authenticated user, roles, etc. here.
 */
export interface SecurityContext { [key: string]: any }

/**
 * Error info passed to custom error handlers.
 */
export interface ErrorInfo {
  status: number;
  code: string;
  message: string;
  details?: any[];
}

/**
 * Operation handler function type.
 * Registered via .register(operationId, handler)
 */
export type OperationHandler = (
  context: RequestContext,
  securityContext: SecurityContext
) => Response | Promise<Response>;

/**
 * Security scheme handler function type.
 * Return true on success, false or Response on failure.
 */
export type SecurityHandler = (
  context: RequestContext,
  requiredScopes: string[],
  securityContext: SecurityContext
) => boolean | Response | Promise<boolean | Response>;

/**
 * Custom error response formatter.
 */
export type ErrorHandler = (
  error: ErrorInfo
) => object | Response | Promise<object | Response>;

/**
 * Custom 404 Not Found handler.
 */
export type NotFoundHandler = (
  request: Request
) => object | Response | Promise<object | Response>;

/**
 * BunOpenAPI - OpenAPI 3.x middleware router with validation for Bun.
 */
declare class BunOpenAPI {
  /**
   * Create a new BunOpenAPI instance.
   */
  constructor(options: BunOpenAPIOptions);

  /**
   * Register a handler for an OpenAPI operation.
   * @param operationId The operationId from your OpenAPI spec
   * @param handler Handler function or null to unregister
   */
  register(operationId: string, handler: OperationHandler | null): void;

  /**
   * Register a security scheme handler (e.g., Bearer, apiKey).
   * @param schemeName Name of the security scheme in components.securitySchemes
   * @param handler Handler function or null to unregister
   */
  registerSecurity(schemeName: string, handler: SecurityHandler | null): void;

  /**
   * Register a custom error response formatter.
   */
  registerErrorHandler(handler: ErrorHandler): void;

  /**
   * Register a custom 404 Not Found handler.
   * @param handler Handler or null to unregister
   */
  registerNotFound(handler: NotFoundHandler | null): void;

  /**
   * Load the OpenAPI definition and generate routes.
   * Returns a routing map compatible with custom routers or Bun.serve (via manual dispatch).
   */
  routes(): Promise<{
    [path: string]: {
      [method in 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS']?: (req: Request) => Promise<Response>;
    } & {
      OPTIONS?: (req: Request) => Promise<Response>;
      '/*'?: (req: Request) => Promise<Response>;
    };
  }>;
}

export default BunOpenAPI;