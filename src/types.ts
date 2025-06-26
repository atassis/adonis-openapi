export type OpenapiInfo = {
  title?: string;
  version?: string;
  description?: string;
}
/**
 * AdonisOpenapi interfaces
 */
export interface AdonisOpenapiOptions {
  appPath?: string;
  authMiddlewares?: string[];
  common: OpenapiCommonOptions;
  debug?: boolean;
  defaultSecurityScheme?: string;
  fileNameInSummary?: boolean;
  ignore: string[];
  info?: OpenapiInfo;
  /*
   * Callback function to modify the generated OpenAPI specification before it is written to the output file.
   * @param docs The generated OpenAPI specification.
   * @returns The modified OpenAPI specification.
   */
  onPreGenerate?: (docs: any) => Promise<any> | any;
  /*
   * Output file extensions for the generated OpenAPI specification.
   * @default 'both'
   */
  outputFileExtensions?: 'both' | 'json' | 'yaml';
  path: string;
  persistAuthorization?: boolean;
  preferredPutPatch?: string;
  productionEnv?: string;
  securitySchemes?: any;
  snakeCase: boolean;
  tagIndex: number;
}

export interface OpenapiCommonOptions {
  headers: any;
  parameters: any;
}

/**
 * Adonis.JS routes
 */
export interface AdonisRouteMeta {
  resolvedHandler: {
    type: string;
    namespace?: string;
    method?: string;
  };
  resolvedMiddleware: Array<{
    type: string;
    args?: any[];
  }>;
}

export interface V6Handler {
  method?: string;
  moduleNameOrPath?: string;
  reference: string | any[];
  name: string;
}

export interface AdonisRoute {
  methods: string[];
  pattern: string;
  meta: AdonisRouteMeta;
  middleware: string[] | any;
  name?: string;
  params: string[];
  handler?: string | V6Handler;
}

export interface AdonisRoutes {
  root: AdonisRoute[];
}

export const standardTypes = [
  'string',
  'number',
  'integer',
  'datetime',
  'date',
  'boolean',
  'any',
].flatMap((type) => [type, `${type}[]`]);
