import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VineValidator } from '@vinejs/vine';
import HTTPStatusCode from 'http-status-code';
import YAML from 'json-to-pretty-yaml';
import _, { isEmpty, isUndefined } from 'lodash';

import { serializeV6Handler, serializeV6Middleware } from './adonis-helpers';
import { ExampleGenerator, ExampleInterfaces } from './example-generator';
import { formatOperationId, mergeParams } from './helpers';
import { extractRouteInfos, parseModelProperties } from './parsers';
import { getAnnotations } from './parsers/comment-parser';
import { parseEnums } from './parsers/enum-parser';
import { parseInterfaces } from './parsers/interface-parser';
import { validatorToObject } from './parsers/validator-parser';
import { scalarCustomCss } from './scalar-custom-css';
import type { AdonisOpenapiOptions, AdonisRoute, AdonisRoutes, v6Handler } from './types';

export type CustomPaths = Record<string, string>;

export const renderRapidoc = (url: string, style = 'view') => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <script type="module" src="https://unpkg.com/rapidoc/dist/rapidoc-min.js"></script>
    <title>API Documentation - Rapidoc</title>
  </head>
  <body>
    <rapi-doc
      spec-url = "${url}"
      theme = "dark"
      bg-color = "#24283b"
      schema-style="tree"
      schema-expand-level = "10"
      header-color = "#1a1b26"
      allow-try = "true"
      nav-hover-bg-color = "#1a1b26"
      nav-bg-color = "#24283b"
      text-color = "#c0caf5"
      nav-text-color = "#c0caf5"
      primary-color = "#9aa5ce"
      heading-text = "Documentation"
      sort-tags = "true"
      render-style = "${style}"
      default-schema-tab = "example"
      show-components = "true"
      allow-spec-url-load = "false"
      allow-spec-file-load = "false"
      sort-endpoints-by = "path"
    />
  </body>
</html>
`;

export const renderSwaggerUI = (url: string, persistAuthorization = false) => `
<!DOCTYPE html>
<html lang="en">
  <head>
  		<meta charset="UTF-8">
  		<meta name="viewport" content="width=device-width, initial-scale=1.0">
  		<meta http-equiv="X-UA-Compatible" content="ie=edge">
  		<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.1.3/swagger-ui-standalone-preset.js"></script>
  		<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.1.3/swagger-ui-bundle.js"></script>
  		<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.1.3/swagger-ui.css" />
    <title>API Documentation - SwaggerUI</title>
  </head>
  <body>
  		<div id="swagger-ui"></div>
  		<script>
  				window.onload = function() {
  					SwaggerUIBundle({
  						url: "${url}",
  						dom_id: '#swagger-ui',
  						presets: [
  							SwaggerUIBundle.presets.apis,
  							SwaggerUIStandalonePreset
  						],
  						layout: "BaseLayout",
            ${persistAuthorization ? 'persistAuthorization: true,' : ''}
  					})
  				}
  		</script>
  </body>
</html>
`;

export const renderScalar = (url: string, proxyUrl = 'https://proxy.scalar.com') => `
<!doctype html>
<html>
  <head>
  <title>API Documentation - Scalar</title>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1" />
    <style>
    ${scalarCustomCss}
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="${url}"
      data-proxy-url="${proxyUrl}"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
    `;

export const renderStoplight = (url: string, theme: 'light' | 'dark' = 'dark') => `
<!doctype html>
<html data-theme="${theme}">
  <head>
    <title>API Documentation - Stoplight</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <script src="https://unpkg.com/@stoplight/elements/web-components.min.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/@stoplight/elements/styles.min.css">
  </head>
  <body style="min-height:100vh">
    <elements-api
      style="display:block;height:100vh;width:100%;"
      apiDescriptionUrl=${url}
      router="hash"
      layout="sidebar"
    />
  </body>
</html>
`;

async function getDataBasedOnAdonisVersion(
  route: AdonisRoute,
  customPaths: CustomPaths,
  options: AdonisOpenapiOptions,
  schemas: Record<string, any>,
) {
  let sourceFile = '';
  let action = '';
  let customAnnotations;
  let operationId = '';
  if (route.meta.resolvedHandler !== null && route.meta.resolvedHandler !== undefined) {
    if (
      typeof route.meta.resolvedHandler.namespace !== 'undefined' &&
      route.meta.resolvedHandler.method !== 'handle'
    ) {
      sourceFile = route.meta.resolvedHandler.namespace;

      action = route.meta.resolvedHandler.method;
      // If not defined by an annotation, use the combination of "controllerNameMethodName"
      if (action !== '' && isUndefined(operationId) && route.handler) {
        operationId = formatOperationId(route.handler as string);
      }
    }
  }

  let v6handler = <v6Handler>route.handler;
  if (
    v6handler.reference !== null &&
    v6handler.reference !== undefined &&
    v6handler.reference !== ''
  ) {
    if (!Array.isArray(v6handler.reference)) {
      // handles magic strings
      // router.resource('/test', '#controllers/test_controller')
      [sourceFile, action] = v6handler.reference.split('.');
      const split = sourceFile.split('/');

      if (split[0].includes('#')) {
        sourceFile = sourceFile.replaceAll(split[0], customPaths[split[0]]);
      } else {
        sourceFile = `${options.appPath}/controllers/${sourceFile}`;
      }
      operationId = formatOperationId(v6handler.reference);
    } else {
      // handles lazy import
      // const TestController = () => import('#controllers/test_controller')
      v6handler = await serializeV6Handler(v6handler);
      action = v6handler.method;
      sourceFile = v6handler.moduleNameOrPath;
      operationId = formatOperationId(`${sourceFile}.${action}`);
      const split = sourceFile.split('/');
      if (split[0].includes('#')) {
        sourceFile = sourceFile.replaceAll(split[0], customPaths[split[0]]);
      } else {
        sourceFile = `${options.appPath}/${sourceFile}`;
      }
    }
  }

  if (sourceFile !== '' && action !== '') {
    sourceFile = `${sourceFile.replace('App/', 'app/')}.ts`;
    sourceFile = sourceFile.replace('.js', '');

    customAnnotations = await getAnnotations(
      new ExampleGenerator(schemas),
      options,
      sourceFile,
      action,
    );
  }
  if (
    typeof customAnnotations !== 'undefined' &&
    typeof customAnnotations.operationId !== 'undefined' &&
    customAnnotations.operationId !== ''
  ) {
    operationId = customAnnotations.operationId;
  }
  if (options.debug) {
    if (sourceFile !== '') {
      console.log(
        typeof customAnnotations !== 'undefined' && !_.isEmpty(customAnnotations)
          ? `\x1b[32m✓ FOUND for ${action}\x1b[0m`
          : `\x1b[33m✗ MISSING for ${action}\x1b[0m`,

        `${sourceFile} (${route.methods[0].toUpperCase()} ${route.pattern})`,
      );
    }
  }
  return { sourceFile, action, customAnnotations, operationId };
}
export function jsonToYaml(json: any) {
  return YAML.stringify(json);
}

async function readLocalFile(rootPath: string, type = 'yml') {
  const filePath = `${rootPath}openapi.${type}`;
  const data = await readFile(filePath, 'utf-8');
  if (!data) {
    console.error('Error reading file');
    return;
  }
  return data;
}

async function getFiles(dir: string, files_: string[] = []) {
  const files = await readdir(dir);
  for (const i in files) {
    const name = `${dir}/${files[i]}`;
    if ((await stat(name)).isDirectory()) {
      await getFiles(name, files_);
    } else {
      files_.push(name);
    }
  }
  return files_;
}

async function getInterfaces(customPaths: CustomPaths, options: AdonisOpenapiOptions) {
  let interfaces = {
    ...ExampleInterfaces.paginationInterface(),
  };
  let p = join(options.appPath, 'Interfaces');
  let p6 = join(options.appPath, 'interfaces');

  if (typeof customPaths['#interfaces'] !== 'undefined') {
    // it's v6
    p6 = p6.replaceAll('app/interfaces', customPaths['#interfaces']);
    p6 = p6.replaceAll('app\\interfaces', customPaths['#interfaces']);
  }

  if (!existsSync(p) && !existsSync(p6)) {
    if (options.debug) {
      console.log("Interface paths don't exist", p, p6);
    }
    return interfaces;
  }
  if (existsSync(p6)) {
    p = p6;
  }
  const files = await getFiles(p, []);
  if (options.debug) {
    console.log('Found interfaces files', files);
  }
  for (let file of files) {
    file = file.replace('.js', '');
    const data = await readFile(file, 'utf8');
    file = file.replace('.ts', '');
    interfaces = {
      ...interfaces,
      ...parseInterfaces(data),
    };
  }

  return interfaces;
}

async function getSerializers(customPaths: CustomPaths, options: AdonisOpenapiOptions) {
  const serializers = {};
  let p6 = join(options.appPath, 'serializers');

  if (typeof customPaths['#serializers'] !== 'undefined') {
    // it's v6
    p6 = p6.replaceAll('app/serializers', customPaths['#serializers']);
    p6 = p6.replaceAll('app\\serializers', customPaths['#serializers']);
  }

  if (!existsSync(p6)) {
    if (options.debug) {
      console.log("Serializers paths don't exist", p6);
    }
    return serializers;
  }

  const files = await getFiles(p6, []);
  if (options.debug) {
    console.log('Found serializer files', files);
  }

  for (let file of files) {
    if (/^[a-zA-Z]:/.test(file)) {
      file = `file:///${file}`;
    }

    const val = await import(file);

    for (const [key, value] of Object.entries(val)) {
      if (key.indexOf('Serializer') > -1) {
        serializers[key] = value;
      }
    }
  }

  return serializers;
}

async function getModels(customPaths: CustomPaths, options: AdonisOpenapiOptions) {
  const models = {};
  let p = join(options.appPath, 'Models');
  let p6 = join(options.appPath, 'models');

  if (typeof customPaths['#models'] !== 'undefined') {
    // it's v6
    p6 = p6.replaceAll('app/models', customPaths['#models']);
    p6 = p6.replaceAll('app\\models', customPaths['#models']);
  }

  if (!existsSync(p) && !existsSync(p6)) {
    if (options.debug) {
      console.log("Model paths don't exist", p, p6);
    }
    return models;
  }
  if (existsSync(p6)) {
    p = p6;
  }
  const files = await getFiles(p, []);
  if (options.debug) {
    console.log('Found model files', files);
  }
  for (let file of files) {
    file = file.replace('.js', '');
    const data = await readFile(file, 'utf8');
    file = file.replace('.ts', '');
    const split = file.split('/');
    let name = split[split.length - 1].replace('.ts', '');
    file = file.replace('app/', '/app/');
    const parsed = parseModelProperties(options.snakeCase, data);
    if (parsed.name !== '') {
      name = parsed.name;
    }
    const schema = {
      type: 'object',
      required: parsed.required,
      properties: parsed.props,
      description: `${name} (Model)`,
    };
    models[name] = schema;
  }
  return models;
}

async function getValidators(customPaths: CustomPaths, options: AdonisOpenapiOptions) {
  const validators = {};
  let p6 = join(options.appPath, 'validators');

  if (typeof customPaths['#validators'] !== 'undefined') {
    // it's v6
    p6 = p6.replaceAll('app/validators', customPaths['#validators']);
    p6 = p6.replaceAll('app\\validators', customPaths['#validators']);
  }

  if (!existsSync(p6)) {
    if (options.debug) {
      console.log("Validators paths don't exist", p6);
    }
    return validators;
  }

  const files = await getFiles(p6, []);
  if (options.debug) {
    console.log('Found validator files', files);
  }

  try {
    for (let file of files) {
      if (/^[a-zA-Z]:/.test(file)) {
        file = `file:///${file}`;
      }

      const val = await import(file);
      for (const [key, value] of Object.entries(val)) {
        if (value.constructor.name.includes('VineValidator')) {
          validators[key] = await validatorToObject(value as VineValidator<any, any>);
          validators[key].description = `${key} (Validator)`;
        }
      }
    }
  } catch (e) {
    console.log(
      "**You are probably using 'node ace serve --hmr', which is not supported yet. Use 'node ace serve --watch' instead.**",
    );
    console.error(e.message);
  }

  return validators;
}

async function getEnums(customPaths: CustomPaths, options: AdonisOpenapiOptions) {
  let enums = {};

  let p = join(options.appPath, 'Types');
  let p6 = join(options.appPath, 'types');

  if (typeof customPaths['#types'] !== 'undefined') {
    // it's v6
    p6 = p6.replaceAll('app/types', customPaths['#types']);
    p6 = p6.replaceAll('app\\types', customPaths['#types']);
  }

  if (!existsSync(p) && !existsSync(p6)) {
    if (options.debug) {
      console.log("Enum paths don't exist", p, p6);
    }
    return enums;
  }

  if (existsSync(p6)) {
    p = p6;
  }

  const files = await getFiles(p, []);
  if (options.debug) {
    console.log('Found enum files', files);
  }

  for (let file of files) {
    file = file.replace('.js', '');
    const data = await readFile(file, 'utf8');
    file = file.replace('.ts', '');
    const split = file.split('/');
    const _name = split[split.length - 1].replace('.ts', '');
    file = file.replace('app/', '/app/');

    const parsedEnums = parseEnums(data);
    enums = {
      ...enums,
      ...parsedEnums,
    };
  }

  return enums;
}

const getSchemas = async (customPaths: CustomPaths, options: AdonisOpenapiOptions) => ({
  Any: {
    description: 'Any JSON object not defined as schema',
  },
  ...(await getInterfaces(customPaths, options)),
  ...(await getSerializers(customPaths, options)),
  ...(await getModels(customPaths, options)),
  ...(await getValidators(customPaths, options)),
  ...(await getEnums(customPaths, options)),
});

export class AdonisOpenapi {
  private options: AdonisOpenapiOptions;
  private schemas = {};
  private customPaths = {};

  async json(routes: any, options: AdonisOpenapiOptions) {
    if (process.env.NODE_ENV === (options.productionEnv || 'production')) {
      const str = await readLocalFile(options.path, 'json');
      return JSON.parse(str);
    }
    return await this.generate(routes, options);
  }

  async writeFile(routes: any, options: AdonisOpenapiOptions) {
    const json = await this.generate(routes, options);
    const contents = jsonToYaml(json);
    const filePathYml = `${options.path}openapi.yml`;
    const filePathJson = `${options.path}openapi.json`;
    const outputFileExtensions = options.outputFileExtensions || 'both';
    if (outputFileExtensions === 'both' || outputFileExtensions === 'yml') {
      await writeFile(filePathYml, contents);
    }
    if (outputFileExtensions === 'both' || outputFileExtensions === 'json') {
      await writeFile(filePathJson, JSON.stringify(json, null, 2));
    }
  }

  async docs(routes: any, options: AdonisOpenapiOptions) {
    if (process.env.NODE_ENV === (options.productionEnv || 'production')) {
      return readLocalFile(options.path);
    }
    return jsonToYaml(await this.generate(routes, options));
  }

  private async generate(adonisRoutes: AdonisRoutes, options: AdonisOpenapiOptions) {
    this.options = {
      ...{
        snakeCase: true,
        preferredPutPatch: 'PUT',
        debug: false,
      },
      ...options,
    };

    const routes = adonisRoutes.root;
    this.options.appPath = `${this.options.path}app`;

    try {
      const pj = await readFile(join(this.options.path, 'package.json'));

      const pjson = JSON.parse(pj.toString());
      if (pjson.imports) {
        Object.entries(pjson.imports).forEach(([key, value]) => {
          const k = (key as string).replaceAll('/*', '');
          this.customPaths[k] = (value as string).replaceAll('/*.js', '').replaceAll('./', '');
        });
      }
    } catch (e) {
      console.error(e);
    }

    this.schemas = await getSchemas(this.customPaths, {
      snakeCase: true,
      preferredPutPatch: 'PUT',
      debug: false,
      ...this.options,
    });
    if (this.options.debug) {
      console.log(this.options);
      console.log('Found Schemas', Object.keys(this.schemas));
      console.log('Using custom paths', this.customPaths);
    }

    const docs = {
      openapi: '3.0.0',
      info: options.info || {
        title: options.title,
        version: options.version,
        description:
          options.description ||
          'Generated by AdonisJS Openapi https://github.com/atassis/adonis-openapi',
      },

      components: {
        responses: {
          Forbidden: {
            description: 'Access token is missing or invalid',
          },
          Accepted: {
            description: 'The request was accepted',
          },
          Created: {
            description: 'The resource has been created',
          },
          NotFound: {
            description: 'The resource has been created',
          },
          NotAcceptable: {
            description: 'The resource has been created',
          },
        },
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
          BasicAuth: {
            type: 'http',
            scheme: 'basic',
          },
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
          ...this.options.securitySchemes,
        },
        schemas: this.schemas,
      },
      paths: {},
      tags: [],
    };
    let paths = {};

    let sscheme = 'BearerAuth';
    if (this.options.defaultSecurityScheme) {
      sscheme = this.options.defaultSecurityScheme;
    }

    const securities = {
      auth: { [sscheme]: ['access'] },
      'auth:api': { [sscheme]: ['access'] },
      ...this.options.authMiddlewares?.reduce((acc, am) => {
        acc[am] = { [sscheme]: ['access'] };
        return acc;
      }, {}),
    };

    const globalTags = [];

    if (this.options.debug) {
      console.log('Route annotations:');
      console.log('Checking if controllers have propper comment annotations');
      console.log('-----');
    }

    for await (const route of routes) {
      let ignore = false;
      for (const i of options.ignore) {
        if (
          route.pattern === i ||
          (i.endsWith('*') && route.pattern.startsWith(i.slice(0, -1))) ||
          (i.startsWith('*') && route.pattern.endsWith(i.slice(1)))
        ) {
          ignore = true;
          break;
        }
      }
      if (ignore) continue;

      const security = [];
      const responseCodes = {
        GET: '200',
        POST: '201',
        DELETE: '202',
        PUT: '204',
      };

      if (!Array.isArray(route.middleware)) {
        route.middleware = serializeV6Middleware(route.middleware) as string[];
      }

      (route.middleware as string[]).forEach((m) => {
        if (typeof securities[m] !== 'undefined') {
          security.push(securities[m]);
        }
      });

      let { tags, parameters, pattern } = extractRouteInfos(this.options, route.pattern);

      tags.forEach((tag) => {
        if (globalTags.filter((e) => e.name === tag).length > 0) return;
        if (tag === '') return;
        globalTags.push({
          name: tag,
          description: `Everything related to ${tag}`,
        });
      });

      const { sourceFile, action, customAnnotations } = await getDataBasedOnAdonisVersion(
        route,
        this.customPaths,
        options,
        this.schemas,
      );

      route.methods.forEach((method) => {
        let responses = {};
        if (method === 'HEAD') return;

        if (
          route.methods.includes('PUT') &&
          route.methods.includes('PATCH') &&
          method !== this.options.preferredPutPatch
        )
          return;

        let description = '';
        let summary = '';
        let tag = '';
        let operationId: string;

        if (security.length > 0) {
          responses['401'] = {
            description: `Returns **401** (${HTTPStatusCode.getMessage(401)})`,
          };
          responses['403'] = {
            description: `Returns **403** (${HTTPStatusCode.getMessage(403)})`,
          };
        }

        let requestBody = {
          content: {
            'application/json': {},
          },
        };

        let actionParams = {};

        if (action !== '' && typeof customAnnotations[action] !== 'undefined') {
          description = customAnnotations[action].description;
          summary = customAnnotations[action].summary;
          operationId = customAnnotations[action].operationId;
          responses = { ...responses, ...customAnnotations[action].responses };
          requestBody = customAnnotations[action].requestBody;
          actionParams = customAnnotations[action].parameters;
          tag = customAnnotations[action].tag;
        }
        parameters = mergeParams(parameters, actionParams);

        if (tag !== '') {
          globalTags.push({
            name: tag.toUpperCase(),
            description: `Everything related to ${tag.toUpperCase()}`,
          });
          tags = [tag.toUpperCase()];
        }

        if (isEmpty(responses)) {
          responses[responseCodes[method]] = {
            description: HTTPStatusCode.getMessage(responseCodes[method]),
            content: {
              'application/json': {},
            },
          };
        } else {
          if (
            typeof responses[responseCodes[method]] !== 'undefined' &&
            typeof responses[responseCodes[method]].summary !== 'undefined'
          ) {
            if (summary === '') {
              summary = responses[responseCodes[method]].summary;
            }
            delete responses[responseCodes[method]].summary;
          }
          if (
            typeof responses[responseCodes[method]] !== 'undefined' &&
            typeof responses[responseCodes[method]].description !== 'undefined'
          ) {
            description = responses[responseCodes[method]].description;
          }
        }

        if (action !== '' && summary === '') {
          // Solve toLowerCase undefined exception
          // https://github.com/atassis/adonis-openapi/issues/28
          tags[0] = tags[0] ?? '';

          switch (action) {
            case 'index':
              summary = `Get a list of ${tags[0].toLowerCase()}`;
              break;
            case 'show':
              summary = `Get a single instance of ${tags[0].toLowerCase()}`;
              break;
            case 'update':
              summary = `Update ${tags[0].toLowerCase()}`;
              break;
            case 'destroy':
              summary = `Delete ${tags[0].toLowerCase()}`;
              break;
            case 'store':
              summary = `Create ${tags[0].toLowerCase()}`;
              break;
            // frontend defaults
            case 'create':
              summary = `Create (Frontend) ${tags[0].toLowerCase()}`;
              break;
            case 'edit':
              summary = `Update (Frontend) ${tags[0].toLowerCase()}`;
              break;
          }
        }

        const _sf = sourceFile.split('/').at(-1).replace('.ts', '');
        const m: any = {
          summary: `${summary}${action !== '' ? ` (${action})` : 'route'}`,
          description: `${description}\n\n _${sourceFile}_ - **${action}**`,
          operationId: operationId,
          parameters: parameters,
          tags: tags,
          responses: responses,
          security: security,
        };

        if (method !== 'GET' && method !== 'DELETE') {
          m.requestBody = requestBody;
        }

        pattern = pattern.slice(1);
        if (pattern === '') {
          pattern = '/';
        }

        paths = {
          ...paths,
          [pattern]: { ...paths[pattern], [method.toLowerCase()]: m },
        };
      });
    }

    // filter unused tags
    const usedTags = _.uniq(
      Object.entries(paths).flatMap(([_p, val]) => Object.entries(val)[0][1].tags),
    );

    docs.tags = globalTags.filter((tag) => usedTags.includes(tag.name));
    docs.paths = paths;
    return docs;
  }
}

export default new AdonisOpenapi();
