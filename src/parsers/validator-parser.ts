import { SimpleMessagesProvider, VineValidator } from '@vinejs/vine';
import { exampleByType, exampleByValidatorRule } from '../example-generator';
import { get, set, unset } from 'lodash';

function objToTest(obj) {
  const res = {};
  Object.keys(obj).forEach((key) => {
    if (obj[key].type === 'object') {
      res[key] = objToTest(obj[key].properties);
    } else if (obj[key].type === 'array') {
      if (obj[key].items.type === 'object') {
        res[key] = [objToTest(obj[key].items.properties)];
      } else {
        res[key] = [obj[key].items.example];
      }
    } else {
      res[key] = obj[key].example;
    }
  });
  return res;
}

function parseSchema(json, refs) {
  const obj = {};
  for (const p of json.properties) {
    let meta: {
      minimum?: number;
      maximum?: number;
      choices?: any;
      pattern?: string;
    } = {};
    for (const v of p.validations) {
      if (refs[v.ruleFnId].options?.min) {
        meta = { ...meta, minimum: refs[v.ruleFnId].options.min };
      }
      if (refs[v.ruleFnId].options?.max) {
        meta = { ...meta, maximum: refs[v.ruleFnId].options.max };
      }
      if (refs[v.ruleFnId].options?.choices) {
        meta = { ...meta, choices: refs[v.ruleFnId].options.choices };
      }
      if (refs[v.ruleFnId].options?.toString().includes('/')) {
        meta = { ...meta, pattern: refs[v.ruleFnId].options.toString() };
      }
    }

    // console.dir(p, { depth: null });
    // console.dir(validations, { depth: null });
    // console.log(min, max, choices, regex);

    obj[p.fieldName] =
      p.type === 'object'
        ? { type: 'object', properties: parseSchema(p, refs) }
        : p.type === 'array'
          ? {
              type: 'array',
              items:
                p.each.type === 'object'
                  ? {
                      type: 'object',
                      properties: parseSchema(p.each, refs),
                    }
                  : {
                      type: 'number',
                      example: meta.minimum ? meta.minimum : exampleByType('number'),
                      ...meta,
                    },
            }
          : {
              type: 'number',
              example: meta.minimum ? meta.minimum : exampleByType('number'),
              ...meta,
            };
    if (!p.isOptional) obj[p.fieldName].required = true;
  }
  return obj;
}

async function parsePropsAndMeta(obj, testObj, validator: VineValidator<any, any>) {
  // console.log(Object.keys(errors));
  const [e] = await validator.tryValidate(testObj, {
    messagesProvider: new SimpleMessagesProvider({
      required: 'REQUIRED',
      string: 'TYPE',
      object: 'TYPE',
      number: 'TYPE',
      boolean: 'TYPE',
    }),
  });

  // if no errors, this means all object-fields are of type number (which we use by default)
  // and we can return the object
  if (e === null) {
    obj.example = testObj;
    return obj;
  }

  const msgs = e.messages;

  for (const m of msgs) {
    const err = m.message;
    let objField = m.field.replace('.', '.properties.');
    if (m.field.includes('.0')) {
      objField = objField.replaceAll('.0', '.items');
    }
    if (err === 'TYPE') {
      set(obj.properties, objField, {
        ...get(obj.properties, objField),
        type: m.rule,
        example: exampleByType(m.rule),
      });
      if (m.rule === 'string') {
        if (get(obj.properties, objField).minimum) {
          set(obj.properties, objField, {
            ...get(obj.properties, objField),
            minLength: get(obj.properties, objField).minimum,
          });
          unset(obj.properties, `${objField}.minimum`);
        }
        if (get(obj.properties, objField).maximum) {
          set(obj.properties, objField, {
            ...get(obj.properties, objField),
            maxLength: get(obj.properties, objField).maximum,
          });
          unset(obj.properties, `${objField}.maximum`);
        }
      }

      set(testObj, m.field, exampleByType(m.rule));
    }

    if (err === 'FORMAT') {
      set(obj.properties, objField, {
        ...get(obj.properties, objField),
        format: m.rule,
        type: 'string',
        example: exampleByValidatorRule(m.rule),
      });
      set(testObj, m.field, exampleByValidatorRule(m.rule));
    }
  }

  // console.dir(obj, { depth: null });
  obj.example = testObj;
  return obj;
}

export async function validatorToObject(validator: VineValidator<any, any>) {
  // console.dir(validator.toJSON()["refs"], { depth: null });
  // console.dir(json, { depth: null });
  const obj = {
    type: 'object',
    properties: parseSchema(validator.toJSON().schema.schema, validator.toJSON().refs),
  };
  // console.dir(obj, { depth: null });
  const testObj = objToTest(obj.properties);
  return await parsePropsAndMeta(obj, testObj, validator);
}
