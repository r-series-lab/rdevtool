export type EditableHttpPair = {
  name: string;
  value: string;
};

export type EditableHttpRequest = {
  url: string;
  method: string;
  query: EditableHttpPair[];
  headers: EditableHttpPair[];
  body: string;
  credentials: RequestCredentials;
  mode: RequestMode | "";
  warnings: string[];
};

const FORBIDDEN_HEADER_NAMES = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "permissions-policy",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
]);

export const HTTP_REQUEST_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
export const HTTP_REQUEST_CREDENTIALS: RequestCredentials[] = [
  "include",
  "same-origin",
  "omit",
];
export const HTTP_REQUEST_MODES: Array<RequestMode | ""> = [
  "",
  "cors",
  "same-origin",
  "no-cors",
];

export function createEditableHttpRequest(
  initial: Partial<EditableHttpRequest> = {},
): EditableHttpRequest {
  return {
    url: initial.url ?? "",
    method: initial.method ?? "GET",
    query: initial.query ? [...initial.query] : [],
    headers: initial.headers ? [...initial.headers] : [],
    body: initial.body ?? "",
    credentials: initial.credentials ?? "same-origin",
    mode: initial.mode ?? "",
    warnings: initial.warnings ? [...initial.warnings] : [],
  };
}

export function isForbiddenHttpRequestHeader(name: string) {
  const normalized = name.trim().toLowerCase();
  return (
    FORBIDDEN_HEADER_NAMES.has(normalized) ||
    normalized.startsWith("proxy-") ||
    normalized.startsWith("sec-")
  );
}

export function isSensitiveHttpRequestHeader(name: string) {
  const normalized = name.trim().toLowerCase();
  return [
    "authorization",
    "cookie",
    "password",
    "secret",
    "token",
    "api-key",
    "apikey",
    "csrf",
    "xsrf",
  ].some((marker) => normalized.includes(marker));
}

export function formatHttpRequestJsonBody(body: string) {
  if (!body.trim()) {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    throw new Error("Body 不是合法 JSON");
  }
}

export function buildHttpRequestUrl(request: EditableHttpRequest) {
  const query = new URLSearchParams();
  for (const pair of request.query) {
    query.append(pair.name, pair.value);
  }
  const queryText = query.toString();
  return `${request.url}${queryText ? `?${queryText}` : ""}`;
}

export function validateHttpRequest(request: EditableHttpRequest) {
  const errors: string[] = [];
  const requestUrl = buildHttpRequestUrl(request).trim();
  if (!requestUrl) {
    errors.push("请求 URL 不能为空");
  } else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(requestUrl) && !/^https?:/i.test(requestUrl)) {
    errors.push("页面请求仅支持 HTTP、HTTPS 或相对 URL");
  }
  if (!HTTP_REQUEST_METHODS.includes(request.method.toUpperCase())) {
    errors.push(`不支持请求方法 ${request.method}`);
  }
  if (["GET", "HEAD"].includes(request.method.toUpperCase()) && request.body.trim()) {
    errors.push(`${request.method.toUpperCase()} 请求不能携带 Body`);
  }
  for (const header of request.headers) {
    const name = header.name.trim();
    if (!name) {
      errors.push("Header 名称不能为空");
    } else if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
      errors.push(`Header 名称无效：${name}`);
    } else if (isForbiddenHttpRequestHeader(name)) {
      errors.push(`Header ${name} 由浏览器控制，不能手动设置`);
    }
  }
  return errors;
}

export function buildBrowserHttpRequestScript(request: EditableHttpRequest) {
  const errors = validateHttpRequest(request);
  if (errors.length > 0) {
    throw new Error(errors[0]);
  }

  const method = request.method.toUpperCase();
  const headers = Object.fromEntries(
    request.headers
      .filter((header) => header.name.trim())
      .map((header) => [header.name.trim(), header.value]),
  );
  const options: Record<string, unknown> = {
    method,
    credentials: request.credentials,
    headers,
  };
  if (request.mode) {
    options.mode = request.mode;
  }
  if (request.body && !["GET", "HEAD"].includes(method)) {
    options.body = request.body;
  }

  const input = JSON.stringify({
    url: buildHttpRequestUrl(request),
    options,
    maxBodyChars: 1024 * 1024,
  });

  return `const __request = ${input};
const __startedAt = performance.now();
const __response = await fetch(__request.url, __request.options);
const __rawText = await __response.text();
const __truncated = __rawText.length > __request.maxBodyChars;
const __previewText = __truncated
  ? __rawText.slice(0, __request.maxBodyChars)
  : __rawText;
const __contentType = __response.headers.get("content-type") || "";
let __responseBody = __previewText;
if (!__truncated && (__contentType.includes("json") || /^[\\s]*[\\[{]/.test(__previewText))) {
  try {
    __responseBody = JSON.parse(__previewText);
  } catch {
    __responseBody = __previewText;
  }
}
return {
  kind: "browser-request",
  method: __request.options.method,
  requestUrl: __request.url,
  url: __response.url,
  ok: __response.ok,
  status: __response.status,
  statusText: __response.statusText,
  redirected: __response.redirected,
  durationMs: Math.round((performance.now() - __startedAt) * 10) / 10,
  responseHeaders: Object.fromEntries(__response.headers.entries()),
  responseBody: __responseBody,
  responseBodyChars: __rawText.length,
  responseBodyTruncated: __truncated
};`;
}
