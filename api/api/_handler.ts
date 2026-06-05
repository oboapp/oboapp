import type { IncomingMessage, ServerResponse } from "http";
import app from "../src/index";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const proto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : (req.headers["x-forwarded-proto"] ?? "https");
  const host = Array.isArray(req.headers["x-forwarded-host"])
    ? req.headers["x-forwarded-host"][0]
    : (req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost");
  const url = new URL(req.url ?? "/", `${proto}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const request = new Request(url.toString(), {
    method: req.method,
    headers,
  });

  const response = await app.fetch(request);

  res.statusCode = response.status;
  response.headers.forEach((value: string, key: string) => {
    res.setHeader(key, value);
  });
  const body = await response.text();
  res.end(body);
}
