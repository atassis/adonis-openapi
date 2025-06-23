import { readFile } from 'node:fs/promises';
import extract from 'extract-comments';
import HTTPStatusCode from 'http-status-code';

import { jsonToRef, parseRef, Schemas } from '../example-generator.js';
import { AdonisOpenapiOptions } from '../types.js';
import { getBetweenBrackets, has, isJSONString } from '../utils.js';

export type Param = {
  in: string;
  name: string;
  description: string;
  schema: {
    example: string;
    enum?: string[];
    type: string;
  };
  required: boolean;
};

const arrayItems = (schemas: Schemas, json) => {
  const oneOf = [];

  const t = typeof json[0];

  if (t === 'string') {
    json.forEach((j) => {
      const value = parseRef(schemas, j);

      if (has(value, 'content.application/json.schema.$ref')) {
        oneOf.push({
          $ref: value.content['application/json'].schema.$ref,
        });
      }
    });
  }

  if (oneOf.length > 0) {
    return { oneOf: oneOf };
  }
  return { type: typeof json[0] };
};

const parseBody = (schemas: Schemas, rawLine: string, type: string) => {
  const line = rawLine.replace(`@${type} `, '');

  const isJson = isJSONString(line);

  if (isJson) {
    // No need to try/catch this JSON.parse as we already did that in the isJSONString function
    const json = JSON.parse(line);
    const o = jsonToObj(schemas, json);
    return {
      content: {
        'application/json': {
          schema: {
            type: Array.isArray(json) ? 'array' : 'object',
            ...(Array.isArray(json) ? { items: arrayItems(schemas, json) } : o),
          },

          example: jsonToRef(schemas, json),
        },
      },
    };
  }
  return parseRef(schemas, line);
};

const jsonToObj = (schemas: Schemas, json: Record<string, any>) => ({
  type: 'object',
  properties: Object.keys(json).reduce((acc, key) => {
    const t = typeof json[key];
    let value = json[key];
    const originalValue = json[key];
    if (t === 'object') {
      value = jsonToObj(schemas, json[key]);
    }
    if (t === 'string' && value.includes('<') && value.includes('>')) {
      value = parseRef(schemas, value);
      if (originalValue.includes('[]')) {
        let ref = '';
        if (has(value, 'content.application/json.schema.$ref')) {
          ref = value.content['application/json'].schema.$ref;
        }
        if (has(value, 'content.application/json.schema.items.$ref')) {
          ref = value.content['application/json'].schema.items.$ref;
        }
        value = {
          type: 'array',
          items: {
            $ref: ref,
          },
        };
      } else {
        value = {
          $ref: value.content['application/json'].schema.$ref,
        };
      }
    }
    acc[key] = value;
    return acc;
  }, {}),
});

const parseResponseBody = (schemas: Schemas, responseLine: string) => {
  const responses = {};
  const line = responseLine.replace('@responseBody ', '');
  const [status, res, desc] = line.split(' - ');
  if (typeof status === 'undefined') return;
  responses[status] = parseBody(schemas, res || '', 'responseBody');
  responses[status].description = desc;
  return responses;
};

const parseResponseHeader = (options: AdonisOpenapiOptions, responseLine: string) => {
  let description = '';
  let example: any = '';
  let type = 'string';

  const line = responseLine.replace('@responseHeader ', '');
  const [status, name, desc, meta] = line.split(' - ');

  if (typeof status === 'undefined' || typeof name === 'undefined') {
    return null;
  }

  if (typeof desc !== 'undefined') {
    description = desc;
  }

  if (name.includes('@use')) {
    const use = getBetweenBrackets(name, 'use');
    const used = use.split(',');
    let h = {};
    used.forEach((u) => {
      if (typeof options.common.headers[u] === 'undefined') {
        return;
      }
      const common = options.common.headers[u];
      h = { ...h, ...common };
    });

    return {
      status: status,
      header: h,
    };
  }

  if (typeof meta !== 'undefined') {
    example = getBetweenBrackets(meta, 'example');
    const mtype = getBetweenBrackets(meta, 'type');
    if (mtype !== '') {
      type = mtype;
    }
  }

  if (example === '' || example === null) {
    switch (type) {
      case 'string':
        example = 'string';
        break;
      case 'integer':
        example = 1;
        break;
      case 'float':
        example = 1.5;
        break;
    }
  }

  const h = {
    schema: { type: type, example: example },
    description: description,
  };

  return {
    status: status,
    header: {
      [name]: h,
    },
  };
};

const parseRequestFormDataBody = (schemas: Schemas, rawLine: string) => {
  const line = rawLine.replace('@requestFormDataBody ', '');
  let json = {};
  const required = [];
  const isJson = isJSONString(line);
  if (!isJson) {
    // try to get json from reference
    const rawRef = line.substring(line.indexOf('<') + 1, line.lastIndexOf('>'));
    const cleandRef = rawRef.replace('[]', '');
    if (cleandRef === '') {
      return;
    }
    const parsedRef = parseRef(schemas, line, true);
    const props: Record<string, { type: string; format: string }> = {};
    const ref = schemas[cleandRef];
    const ks = [];
    if (ref.required && Array.isArray(ref.required)) required.push(...ref.required);
    for (const [key, value] of Object.entries(ref.properties)) {
      if (typeof parsedRef[key] !== 'undefined') {
        ks.push(key);
        if (value.required) {
          required.push(key);
        }

        props[key] = {
          type: typeof value.type === 'undefined' ? 'string' : value.type,
          format: typeof value.format === 'undefined' ? 'string' : value.format,
        };
      }
    }

    const appends = Object.keys(parsedRef).filter((k) => !ks.includes(k));
    json = props;
    if (appends.length > 0) {
      appends.forEach((a) => {
        json[a] = parsedRef[a];
      });
    }
  } else {
    json = JSON.parse(line);
    for (const key in json) {
      if (json[key].required === 'true') {
        required.push(key);
      }
    }
  }
  // No need to try/catch this JSON.parse as we already did that in the isJSONString function

  return {
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: json,
          required,
        },
      },
    },
  };
};

const parseAnnotations = (schemas: Schemas, options: AdonisOpenapiOptions, lines: string[]) => {
  let summary = '';
  let tag = '';
  let description = '';
  let operationId: string | undefined;
  let responses = {};
  let requestBody;
  const parameters: Record<string, Param> = {};
  const headers = {};

  for (const line of lines) {
    if (line.startsWith('@summary')) {
      summary = line.replace('@summary ', '');
    } else if (line.startsWith('@tag')) {
      tag = line.replace('@tag ', '');
    } else if (line.startsWith('@description')) {
      description = line.replace('@description ', '');
    } else if (line.startsWith('@operationId')) {
      operationId = line.replace('@operationId ', '');
    } else if (line.startsWith('@responseBody')) {
      responses = {
        ...responses,
        ...parseResponseBody(schemas, line),
      };
    } else if (line.startsWith('@responseHeader')) {
      const header = parseResponseHeader(options, line);
      if (header === null) {
        console.error(`Error with line: ${line}`);
        return;
      }
      headers[header.status] = {
        ...headers[header.status],
        ...header.header,
      };
    } else if (line.startsWith('@requestBody')) {
      requestBody = parseBody(schemas, line, 'requestBody');
    } else if (line.startsWith('@requestFormDataBody')) {
      const parsedBody = parseRequestFormDataBody(schemas, line);
      if (parsedBody) {
        requestBody = parsedBody;
      }
    } else if (line.startsWith('@param')) {
      const parsedParams = parseParam(options, line);
      for (const [key, parsedParam] of parsedParams) {
        parameters[key] = parsedParam;
      }
    }
  }

  for (const [key, _value] of Object.entries(responses)) {
    if (typeof headers[key] !== 'undefined') {
      responses[key].headers = headers[key];
    }
    if (!responses[key].description) {
      responses[key].description = `Returns **${key}** (${HTTPStatusCode.getMessage(key)}) as **${
        Object.entries(responses[key].content)[0][0]
      }**`;
    }
  }

  return {
    description,
    responses,
    requestBody,
    parameters,
    summary,
    operationId,
    tag,
  };
};

const parseParam = (options: AdonisOpenapiOptions, line: string): [string, Param][] => {
  let where = 'path';
  let required = true;
  let type = 'string';
  let example: any = null;
  let enums = [];

  if (line.startsWith('@paramUse')) {
    return getBetweenBrackets(line, 'paramUse')
      .split(',')
      .reduce((acc, u) => {
        if (typeof options.common.parameters[u] !== 'undefined') {
          const common = options.common.parameters[u];
          if (Array.isArray(common)) {
            for (const param of common) {
              acc.push([param.name, param]);
            }
          } else {
            acc.push([common.name, common]);
          }
        }
        return acc;
      }, []);
  }

  if (line.startsWith('@paramPath')) {
    required = false;
  }
  if (line.startsWith('@paramQuery')) {
    required = false;
  }

  const m = line.match('@param([a-zA-Z]*)');
  if (m !== null) {
    where = m[1].toLowerCase();
    line = line.replace(`${m[0]} `, '');
  }

  let [param, des, meta] = line.split(' - ');
  if (typeof param === 'undefined') {
    return;
  }
  if (typeof des === 'undefined') {
    des = '';
  }

  if (typeof meta !== 'undefined') {
    if (meta.includes('@required')) {
      required = true;
    }
    const en = getBetweenBrackets(meta, 'enum');
    example = getBetweenBrackets(meta, 'example');
    const mtype = getBetweenBrackets(meta, 'type');
    if (mtype !== '') {
      type = mtype;
    }
    if (en !== '') {
      enums = en.split(',');
      example = enums[0];
    }
  }

  const p: Param = {
    in: where,
    name: param,
    description: des,
    schema: {
      example: example,
      type: type,
    },
    required: required,
  };

  if (enums.length > 1) {
    p.schema.enum = enums;
  }

  return [[param, p]];
};

export async function getAnnotations(
  schemas: Schemas,
  options: AdonisOpenapiOptions,
  file: string,
  action: string,
) {
  const parsedFiles: { [file: string]: string } = {};
  const annotations = {};
  let newdata = '';
  if (typeof file === 'undefined') return;

  if (typeof parsedFiles[file] !== 'undefined') {
    newdata = parsedFiles[file];
  } else {
    try {
      const data = await readFile(file, 'utf8');
      for (const line of data.split('\n')) {
        const l = line.trim();
        if (!l.startsWith('@')) {
          newdata += `${l}\n`;
        }
      }
      parsedFiles[file] = newdata;
    } catch (_e) {
      console.error('\x1b[31m✗ File not found\x1b[0m', file);
    }
  }

  const comments = extract(newdata);
  if (comments.length > 0) {
    comments.forEach((comment) => {
      if (comment.type !== 'BlockComment') return;
      let lines = comment.value.split('\n').filter((l) => l !== '');
      // fix for decorators
      if (lines[0].trim() !== `@${action}`) return;
      lines = lines.filter((l) => l !== '');

      annotations[action] = parseAnnotations(schemas, options, lines);
    });
  }
  return annotations;
}
