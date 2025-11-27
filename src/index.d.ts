declare class BunOpenAPI {
  constructor(options: { definition: string | object; cors?: Record<string, string> });
  register(operationId: string, handler: (ctx: any) => Promise<Response>): void;
  registerSecurity(schemeName: string, handler: (ctx: any, scopes: string[]) => Promise<boolean | Response>): void;
  routes(): Promise<Record<string, Record<string, (req: Request) => Promise<Response>>>>;
}

export default BunOpenAPI;