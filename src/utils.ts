export const snakeCase = (str: string): string =>
  str
    ?.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
    ?.map((x) => x.toLowerCase())
    .join('_') || '';

export const camelCase = (str: string): string =>
  str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, (m) => m.toLowerCase());

export const startCase = (str: string): string =>
  str
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Split camelCase
    .replace(/[_-]+/g, ' ') // Replace _ and - with space
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim()
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

export const has = (obj: object, path: string | Array<string | number>): boolean => {
  if (!obj) return false;
  const parts = Array.isArray(path) ? path : path.replace(/\[(\w+)\]/g, '.$1').split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current && Object.hasOwn(current, part)) {
      current = current[part];
    } else {
      return false;
    }
  }
  return true;
};

export const get = (obj: any, path: string | Array<string | number>, defaultValue?: any): any => {
  const parts = Array.isArray(path)
    ? path
    : path
        .replace(/\[(\w+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current == null) return defaultValue;
    current = current[part];
  }
  return current === undefined ? defaultValue : current;
};

export const set = (obj: any, path: string | Array<string | number>, value: any): any => {
  const parts = Array.isArray(path)
    ? path
    : path
        .replace(/\[(\w+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === parts.length - 1) {
      current[part] = value;
    } else {
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }
  }
  return obj;
};

export const unset = (obj: any, path: string | Array<string | number>): boolean => {
  const parts = Array.isArray(path)
    ? path
    : path
        .replace(/\[(\w+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current || typeof current !== 'object') return false;
    current = current[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (current && Object.hasOwn(current, last)) {
    delete current[last];
    return true;
  }
  return false;
};

export const isEmpty = (val: any): boolean => {
  if (val == null) return true; // null or undefined
  if (typeof val === 'string' || Array.isArray(val)) return val.length === 0;
  if (typeof val === 'object') return Object.keys(val).length === 0;
  return true; // for numbers, booleans, etc.
};

export const isUndefined = (val: any): boolean => typeof val === 'undefined';

export const uniq = <T>(arr: Iterable<T>): T[] => [...new Set(arr)];

export function isJSONString(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch (_error) {
    return false;
  }
}

export function getBetweenBrackets(value: string, start: string): string {
  const match = value.match(new RegExp(`${start}\\(([^()]*)\\)`, 'g'));

  if (match !== null) {
    let m = match[0].replace(`${start}(`, '').replace(')', '');

    if (start !== 'example') {
      m = m.replace(/ /g, '');
    }
    if (start === 'paginated') {
      return 'true';
    }
    return m;
  }

  return '';
}

export function mergeParams(initial, custom) {
  const merge = Object.assign(initial, custom);
  const params = [];
  for (const [_key, value] of Object.entries(merge)) {
    params.push(value);
  }

  return params;
}

/**
 * Helpers
 */

export function formatOperationId(inputString: string): string {
  // Remove non-alphanumeric characters and split the string into words
  const cleanedWords = inputString.replace(/[^a-zA-Z0-9]/g, ' ').split(' ');

  // Pascal casing words
  const pascalCasedWords = cleanedWords.map((word) => startCase(camelCase(word)));

  // Generate operationId by joining every parts
  const operationId = pascalCasedWords.join();

  // CamelCase the operationId
  return camelCase(operationId);
}
