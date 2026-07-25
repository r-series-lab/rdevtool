import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { parseChromeFetch } from "../src/lib/fetchImport";
import {
  buildBrowserHttpRequestScript,
  buildHttpRequestUrl,
} from "../src/lib/httpRequest";

type EchoResponse = {
  accepted: boolean;
  method: string;
  query: Record<string, string>;
  requestHeader: string;
  sessionCookiePresent: boolean;
  pageRefererMatches: boolean;
  body: unknown;
};

type BrowserRequestResult = {
  kind: string;
  method: string;
  requestUrl: string;
  ok: boolean;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: EchoResponse;
};

let acceptanceServer: Server;
let acceptanceOrigin = "";
let apiRequestCount = 0;

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

test.beforeAll(async () => {
  acceptanceServer = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", acceptanceOrigin || "http://127.0.0.1");
    response.setHeader("connection", "close");

    if (requestUrl.pathname === "/acceptance") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "acceptance_session=local-page-session; Path=/; HttpOnly; SameSite=Lax",
      });
      response.end(`<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8"><title>网页请求回放验收页</title></head>
  <body><main><h1>网页请求回放验收页</h1><p id="ready">页面会话已建立</p></main></body>
</html>`);
      return;
    }

    if (requestUrl.pathname === "/api/echo" && request.method === "POST") {
      apiRequestCount += 1;
      const rawBody = await readRequestBody(request);
      let body: unknown = rawBody;
      try {
        body = JSON.parse(rawBody);
      } catch {
        // Keep non-JSON request bodies available to the assertion.
      }
      const payload: EchoResponse = {
        accepted: true,
        method: request.method,
        query: Object.fromEntries(requestUrl.searchParams),
        requestHeader: String(request.headers["x-acceptance-run"] || ""),
        sessionCookiePresent: String(request.headers.cookie || "").includes(
          "acceptance_session=local-page-session",
        ),
        pageRefererMatches: request.headers.referer === `${acceptanceOrigin}/acceptance`,
        body,
      };
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(payload));
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    acceptanceServer.once("error", reject);
    acceptanceServer.listen(0, "127.0.0.1", () => {
      const address = acceptanceServer.address() as AddressInfo;
      acceptanceOrigin = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

test.afterAll(async () => {
  acceptanceServer.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    acceptanceServer.close((error) => (error ? reject(error) : resolve()));
  });
});

test("replays an edited imported request inside a real page session through CDP", async ({
  page,
}) => {
  await page.goto(`${acceptanceOrigin}/acceptance`);
  await expect(page.getByRole("heading", { name: "网页请求回放验收页" })).toBeVisible();

  const importedRequest = parseChromeFetch(`fetch("${acceptanceOrigin}/api/echo?year=2026&quarter=Q2", {
    method: "POST",
    credentials: "include",
    mode: "cors",
    headers: {
      accept: "application/json",
      "content-type": "application/json;charset=UTF-8",
      "x-acceptance-run": "imported",
      cookie: "copied-cookie-must-be-removed"
    },
    body: JSON.stringify({ pageNum: 1, pageSize: 100 })
  });`);

  expect(importedRequest.headers.some((header) => header.name === "cookie")).toBe(false);
  expect(importedRequest.warnings.join(" ")).toContain("cookie");

  importedRequest.query = importedRequest.query.map((pair) =>
    pair.name === "year" ? { ...pair, value: "2027" } : pair,
  );
  importedRequest.headers = importedRequest.headers.map((header) =>
    header.name === "x-acceptance-run" ? { ...header, value: "edited" } : header,
  );
  importedRequest.body = JSON.stringify({ pageNum: 2, pageSize: 500 }, null, 2);

  const replayScript = buildBrowserHttpRequestScript(importedRequest);
  const cdp = await page.context().newCDPSession(page);
  const evaluation = await cdp.send("Runtime.evaluate", {
    expression: `(async () => {\n${replayScript}\n})()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });

  expect(evaluation.exceptionDetails).toBeUndefined();
  const result = evaluation.result.value as BrowserRequestResult;
  expect(apiRequestCount).toBe(1);
  expect(result).toMatchObject({
    kind: "browser-request",
    method: "POST",
    requestUrl: buildHttpRequestUrl(importedRequest),
    ok: true,
    status: 200,
    responseBody: {
      accepted: true,
      method: "POST",
      query: { year: "2027", quarter: "Q2" },
      requestHeader: "edited",
      sessionCookiePresent: true,
      pageRefererMatches: true,
      body: { pageNum: 2, pageSize: 500 },
    },
  });
  expect(result.responseHeaders["content-type"]).toContain("application/json");
});
