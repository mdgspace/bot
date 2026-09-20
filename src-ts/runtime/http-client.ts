import * as http from "node:http";
import * as https from "node:https";
import { stringify } from "node:querystring";
import type { HttpCallback, HttpClient } from "./types";

export type RequestFactory = (
  url: URL,
  options: http.RequestOptions,
  callback: (response: http.IncomingMessage) => void,
) => http.ClientRequest;

const request: RequestFactory = (url, options, callback) =>
  (url.protocol === "https:" ? https : http).request(url, options, callback);

export class ScriptHttpClient implements HttpClient {
  private readonly url: URL;
  private readonly headers: Record<string, string> = {};
  private readonly parameters: Record<string, string | number | boolean>;

  constructor(
    url: string,
    private readonly makeRequest: RequestFactory = request,
  ) {
    this.url = new URL(url);
    if (!["http:", "https:"].includes(this.url.protocol))
      throw new Error("Unsupported HTTP protocol");
    this.parameters = Object.fromEntries(this.url.searchParams);
  }

  header(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  query(options: Record<string, string | number | boolean>): this {
    for (const [key, value] of Object.entries(options)) {
      Object.defineProperty(this.parameters, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return this;
  }

  get(): (callback: HttpCallback) => void {
    return (callback) => this.execute("GET", undefined, callback);
  }

  post(body: string): (callback: HttpCallback) => void {
    return (callback) => this.execute("POST", body, callback);
  }

  private execute(
    method: string,
    body: string | undefined,
    callback: HttpCallback,
  ): void {
    let completed = false;
    const finish: HttpCallback = (...args) => {
      if (completed) return;
      completed = true;
      callback(...args);
    };
    try {
      const url = new URL(this.url);
      url.search = stringify(this.parameters);
      const headers = { ...this.headers };
      if (body !== undefined)
        headers["content-length"] = String(Buffer.byteLength(body));
      const req = this.makeRequest(url, { method, headers }, (res) => {
        res.setEncoding("utf8");
        let result = "";
        res.on("data", (chunk) => {
          result += chunk;
        });
        res.on("error", (error) => finish(error, null, null));
        res.on("aborted", () =>
          finish(new Error("HTTP response aborted"), null, null),
        );
        res.on("end", () =>
          finish(
            null,
            { statusCode: res.statusCode ?? 0, headers: res.headers },
            result,
          ),
        );
      });
      req.on("error", (error) => finish(error, null, null));
      req.end(body);
    } catch (error) {
      finish(
        error instanceof Error ? error : new Error(String(error)),
        null,
        null,
      );
    }
  }
}
