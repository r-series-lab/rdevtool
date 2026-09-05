import { describe, expect, it } from "vitest";
import { parseChromeFetch } from "./fetchImport";
import {
  buildBrowserHttpRequestScript,
  buildHttpRequestUrl,
  createEditableHttpRequest,
  formatHttpRequestJsonBody,
  isSensitiveHttpRequestHeader,
  validateHttpRequest,
} from "./httpRequest";

describe("Chrome fetch import", () => {
  it("parses a static Chrome Copy as fetch request", () => {
    const request = parseChromeFetch(`
      fetch("https://example.test/api/items?year=2026&quarter=Q2", {
        headers: {
          accept: "application/json",
          "content-type": "application/json;charset=UTF-8",
          cookie: "must-not-be-imported",
          "sec-fetch-mode": "cors",
          authorization: "Bearer volatile-token"
        },
        referrer: "https://example.test/app",
        body: "{\\"pageNum\\":1,\\"pageSize\\":500}",
        method: "POST",
        mode: "cors",
        credentials: "include"
      });
    `);

    expect(request).toMatchObject({
      url: "https://example.test/api/items",
      method: "POST",
      credentials: "include",
      mode: "cors",
      query: [
        { name: "year", value: "2026" },
        { name: "quarter", value: "Q2" },
      ],
      body: '{\n  "pageNum": 1,\n  "pageSize": 500\n}',
    });
    expect(request.headers.map((header) => header.name)).toEqual([
      "accept",
      "content-type",
      "authorization",
    ]);
    expect(request.warnings.join(" ")).toContain("cookie");
    expect(request.warnings.join(" ")).toContain("sec-fetch-mode");
    expect(request.warnings.join(" ")).toContain("referrer");
    expect(request.warnings.join(" ")).toContain("仅保留在本次编辑中");
    expect(isSensitiveHttpRequestHeader("Authorization")).toBe(true);
  });

  it("supports static JSON.stringify bodies and relative URLs", () => {
    const request = parseChromeFetch(`fetch("/api/report?team=314", {
      method: "POST",
      headers: [["content-type", "application/json"]],
      body: JSON.stringify({ pageNum: 1, filters: ["ready", "done"] })
    })`);

    expect(request.body).toBe(
      '{\n  "pageNum": 1,\n  "filters": [\n    "ready",\n    "done"\n  ]\n}',
    );
    expect(buildHttpRequestUrl(request)).toBe("/api/report?team=314");
  });

  it("rejects executable code outside the fetch call", () => {
    expect(() =>
      parseChromeFetch(`const token = localStorage.token; fetch("/api", { headers: { token } })`),
    ).toThrow("只允许粘贴一条 fetch 调用");
    expect(() => parseChromeFetch(`fetch(resolveUrl(), {})`)).toThrow("fetch URL 必须是静态");
  });

  it("validates edited request fields", () => {
    const request = parseChromeFetch(`fetch("/api/items", { method: "GET" })`);
    request.body = "{}";
    request.headers.push({ name: "Host", value: "example.test" });

    expect(validateHttpRequest(request)).toEqual([
      "GET 请求不能携带 Body",
      "Header Host 由浏览器控制，不能手动设置",
    ]);
  });

  it("rejects non-http absolute URLs while allowing relative URLs", () => {
    const unsafe = parseChromeFetch(`fetch("data:text/plain,hello")`);
    expect(validateHttpRequest(unsafe)).toEqual([
      "页面请求仅支持 HTTP、HTTPS 或相对 URL",
    ]);
    expect(validateHttpRequest(parseChromeFetch(`fetch("../api/items")`))).toEqual([]);
  });

  it("generates an awaited page-context replay script", () => {
    const request = parseChromeFetch(`fetch("/api/items?page=1", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}"
    })`);
    const script = buildBrowserHttpRequestScript(request);

    expect(script).toContain("await fetch(__request.url, __request.options)");
    expect(script).toContain('kind: "browser-request"');
    expect(script).toContain("responseBodyTruncated");
    expect(script).toContain('"credentials":"include"');
  });

  it("formats JSON bodies explicitly", () => {
    expect(formatHttpRequestJsonBody('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(() => formatHttpRequestJsonBody("not json")).toThrow("Body 不是合法 JSON");
  });

  it("creates a reusable blank HTTP request draft", () => {
    expect(createEditableHttpRequest()).toEqual({
      url: "",
      method: "GET",
      query: [],
      headers: [],
      body: "",
      credentials: "same-origin",
      mode: "",
      warnings: [],
    });
  });
});
