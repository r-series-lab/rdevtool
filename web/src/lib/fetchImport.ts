import { parse } from "@babel/parser";
import type {
  ArrayExpression,
  CallExpression,
  Expression,
  ObjectExpression,
  ObjectProperty,
} from "@babel/types";
import {
  HTTP_REQUEST_CREDENTIALS,
  HTTP_REQUEST_MODES,
  createEditableHttpRequest,
  isForbiddenHttpRequestHeader,
  isSensitiveHttpRequestHeader,
  type EditableHttpPair,
  type EditableHttpRequest,
} from "./httpRequest";

type StaticValue =
  | string
  | number
  | boolean
  | null
  | StaticValue[]
  | { [key: string]: StaticValue };

const IGNORED_REQUEST_OPTIONS = new Set([
  "cache",
  "integrity",
  "keepalive",
  "priority",
  "redirect",
  "referrer",
  "referrerpolicy",
  "signal",
]);

function fail(message: string): never {
  throw new Error(message);
}

function expressionArgument(value: CallExpression["arguments"][number], label: string) {
  if (value.type === "SpreadElement" || value.type === "ArgumentPlaceholder") {
    return fail(`${label} 不支持展开或占位参数`);
  }
  return value as Expression;
}

function unwrapExpression(expression: Expression): Expression {
  if (expression.type === "AwaitExpression") {
    return unwrapExpression(expression.argument);
  }
  if (
    expression.type === "TSAsExpression" ||
    expression.type === "TSTypeAssertion" ||
    expression.type === "TypeCastExpression"
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function propertyExpression(value: ObjectProperty["value"], label: string): Expression {
  if (
    value.type === "ArrayPattern" ||
    value.type === "AssignmentPattern" ||
    value.type === "ObjectPattern" ||
    value.type === "RestElement" ||
    value.type === "VoidPattern"
  ) {
    return fail(`${label} 属性不是静态表达式`);
  }
  return value as Expression;
}

function isFetchCallee(expression: CallExpression["callee"]) {
  if (expression.type === "Identifier") {
    return expression.name === "fetch";
  }
  if (expression.type !== "MemberExpression" || expression.optional) {
    return false;
  }
  const object = expression.object;
  if (
    object.type !== "Identifier" ||
    !["window", "globalThis", "self"].includes(object.name)
  ) {
    return false;
  }
  if (!expression.computed && expression.property.type === "Identifier") {
    return expression.property.name === "fetch";
  }
  return expression.property.type === "StringLiteral" && expression.property.value === "fetch";
}

function propertyName(property: ObjectProperty) {
  if (property.computed) {
    return fail("不支持动态对象属性");
  }
  if (property.key.type === "Identifier") {
    return property.key.name;
  }
  if (property.key.type === "StringLiteral" || property.key.type === "NumericLiteral") {
    return String(property.key.value);
  }
  return fail("对象属性名必须是静态文本");
}

function objectProperties(expression: ObjectExpression, label: string) {
  return expression.properties.map((property) => {
    if (property.type !== "ObjectProperty") {
      return fail(`${label} 不支持展开属性或方法`);
    }
    return {
      name: propertyName(property),
      value: propertyExpression(property.value, label),
    };
  });
}

function readStaticValue(expression: Expression, label: string): StaticValue {
  const value = unwrapExpression(expression);
  switch (value.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return value.value;
    case "NullLiteral":
      return null;
    case "TemplateLiteral":
      if (value.expressions.length > 0) {
        return fail(`${label} 不支持包含变量的模板字符串`);
      }
      return value.quasis[0]?.value.cooked ?? value.quasis[0]?.value.raw ?? "";
    case "UnaryExpression": {
      if ((value.operator === "+" || value.operator === "-") && value.argument.type === "NumericLiteral") {
        return value.operator === "-" ? -value.argument.value : value.argument.value;
      }
      return fail(`${label} 包含不支持的一元表达式`);
    }
    case "ArrayExpression":
      return value.elements.map((element) => {
        if (!element || element.type === "SpreadElement") {
          return fail(`${label} 不支持空数组项或展开项`);
        }
        return readStaticValue(element, label);
      });
    case "ObjectExpression":
      return Object.fromEntries(
        objectProperties(value, label).map((property) => [
          property.name,
          readStaticValue(property.value, `${label}.${property.name}`),
        ]),
      );
    default:
      return fail(`${label} 必须是静态文本、数字、数组或对象`);
  }
}

function readStaticString(expression: Expression, label: string) {
  const value = readStaticValue(expression, label);
  if (typeof value !== "string") {
    return fail(`${label} 必须是静态字符串`);
  }
  return value;
}

function readHeaders(expression: Expression) {
  const value = unwrapExpression(expression);
  if (value.type === "ObjectExpression") {
    return objectProperties(value, "headers").map((property) => ({
      name: property.name,
      value: String(readStaticValue(property.value, `headers.${property.name}`) ?? ""),
    }));
  }
  if (value.type === "ArrayExpression") {
    return value.elements.map((element, index) => {
      if (!element || element.type !== "ArrayExpression") {
        return fail(`headers[${index}] 必须是 [name, value]`);
      }
      const pair = element.elements;
      if (pair.length !== 2 || !pair[0] || !pair[1]) {
        return fail(`headers[${index}] 必须包含 name 和 value`);
      }
      if (pair[0].type === "SpreadElement" || pair[1].type === "SpreadElement") {
        return fail(`headers[${index}] 不支持展开项`);
      }
      return {
        name: readStaticString(pair[0], `headers[${index}][0]`),
        value: String(readStaticValue(pair[1], `headers[${index}][1]`) ?? ""),
      };
    });
  }
  return fail("headers 仅支持静态对象或二维数组");
}

function isJsonStringifyCall(expression: CallExpression) {
  const callee = expression.callee;
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "JSON" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "stringify"
  );
}

function readBody(expression: Expression) {
  const value = unwrapExpression(expression);
  if (value.type === "CallExpression" && isJsonStringifyCall(value)) {
    const argument = value.arguments[0];
    if (!argument) {
      return "";
    }
    const staticArgument = expressionArgument(argument, "JSON.stringify");
    return JSON.stringify(readStaticValue(staticArgument, "JSON.stringify"), null, 2);
  }
  const staticValue = readStaticValue(value, "body");
  if (staticValue === null) {
    return "";
  }
  if (typeof staticValue !== "string") {
    return fail("body 必须是静态字符串、null 或 JSON.stringify 静态对象");
  }
  return staticValue;
}

function splitUrl(url: string, warnings: string[]) {
  const hashIndex = url.indexOf("#");
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  if (hashIndex >= 0) {
    warnings.push("URL 的 hash 不会随 HTTP 请求发送，已忽略");
  }
  const queryIndex = withoutHash.indexOf("?");
  if (queryIndex < 0) {
    return { url: withoutHash, query: [] };
  }
  const query = Array.from(new URLSearchParams(withoutHash.slice(queryIndex + 1))).map(
    ([name, value]) => ({ name, value }),
  );
  return { url: withoutHash.slice(0, queryIndex), query };
}

function normalizeHeaders(headers: EditableHttpPair[], warnings: string[]) {
  return headers.filter((header) => {
    if (!isForbiddenHttpRequestHeader(header.name)) {
      return true;
    }
    warnings.push(`浏览器控制 Header ${header.name}，导入时已移除`);
    return false;
  }).map((header) => {
    if (isSensitiveHttpRequestHeader(header.name)) {
      warnings.push(`敏感 Header ${header.name} 仅保留在本次编辑中`);
    }
    return header;
  });
}

function parseCredentials(value: string): RequestCredentials {
  if (HTTP_REQUEST_CREDENTIALS.includes(value as RequestCredentials)) {
    return value as RequestCredentials;
  }
  return fail(`credentials 不支持 ${value}`);
}

function parseMode(value: string): RequestMode | "" {
  if (HTTP_REQUEST_MODES.includes(value as RequestMode | "")) {
    return value as RequestMode | "";
  }
  return fail(`mode 不支持 ${value}`);
}

export function parseChromeFetch(source: string): EditableHttpRequest {
  const trimmed = source.trim();
  if (!trimmed) {
    return fail("请粘贴 Chrome 的 Copy as fetch 内容");
  }

  let file;
  try {
    file = parse(trimmed, {
      sourceType: "script",
      allowAwaitOutsideFunction: true,
    });
  } catch (error) {
    return fail(`fetch 语法无法解析：${error instanceof Error ? error.message : String(error)}`);
  }

  const statements = file.program.body.filter((statement) => statement.type !== "EmptyStatement");
  if (statements.length !== 1 || statements[0]?.type !== "ExpressionStatement") {
    return fail("只允许粘贴一条 fetch 调用，不能包含变量声明或其他语句");
  }
  const expression = unwrapExpression(statements[0].expression);
  if (expression.type !== "CallExpression" || !isFetchCallee(expression.callee)) {
    return fail("未找到标准 fetch(url, options) 调用");
  }
  const urlArgument = expression.arguments[0];
  if (!urlArgument) {
    return fail("fetch 缺少 URL");
  }
  const url = readStaticString(expressionArgument(urlArgument, "fetch URL"), "fetch URL");
  const initialWarnings: string[] = [];
  const request = createEditableHttpRequest({
    ...splitUrl(url, initialWarnings),
    warnings: initialWarnings,
  });
  const warnings = request.warnings;

  const initArgument = expression.arguments[1];
  if (!initArgument) {
    return request;
  }
  const initExpression = unwrapExpression(expressionArgument(initArgument, "fetch options"));
  if (initExpression.type !== "ObjectExpression") {
    return fail("fetch options 必须是静态对象");
  }

  for (const property of objectProperties(initExpression, "fetch options")) {
    const optionName = property.name.toLowerCase();
    switch (optionName) {
      case "method":
        request.method = readStaticString(property.value, "method").toUpperCase();
        break;
      case "headers":
        request.headers = normalizeHeaders(readHeaders(property.value), warnings);
        break;
      case "body":
        request.body = readBody(property.value);
        break;
      case "credentials":
        request.credentials = parseCredentials(readStaticString(property.value, "credentials"));
        break;
      case "mode":
        request.mode = parseMode(readStaticString(property.value, "mode"));
        break;
      default:
        if (IGNORED_REQUEST_OPTIONS.has(optionName)) {
          warnings.push(`请求选项 ${property.name} 由浏览器管理，回放时不导入`);
        } else {
          warnings.push(`暂不支持请求选项 ${property.name}，回放时已忽略`);
        }
    }
  }

  request.body = prettyJsonBody(request.body, request.headers);
  return request;
}

function prettyJsonBody(body: string, headers: EditableHttpPair[]) {
  const contentType = headers
    .find((header) => header.name.trim().toLowerCase() === "content-type")
    ?.value.toLowerCase();
  if (!body.trim() || !contentType?.includes("json")) {
    return body;
  }
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
