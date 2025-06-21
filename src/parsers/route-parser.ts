import type { AdonisOpenapiOptions } from '../types';

/*
   extract path-variables, tags and the uri-pattern
 */
export function extractRouteInfos(options: AdonisOpenapiOptions, p: string) {
  let parameters = {};
  let pattern = '';
  let tags = [];
  let required: boolean;

  const split = p.split('/');
  if (split.length > options.tagIndex) {
    tags = [split[options.tagIndex].toUpperCase()];
  }
  for (let part of split) {
    if (part.startsWith(':')) {
      required = !part.endsWith('?');
      const param = part.replace(':', '').replace('?', '');
      part = `{${param}}`;
      parameters = {
        ...parameters,
        [param]: {
          in: 'path',
          name: param,
          schema: {
            type: 'string',
          },
          required: required,
        },
      };
    }
    pattern += `/${part}`;
  }
  if (pattern.endsWith('/')) {
    pattern = pattern.slice(0, -1);
  }
  return { tags, parameters, pattern };
}
