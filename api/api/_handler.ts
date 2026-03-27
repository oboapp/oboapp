import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../src/index";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const url = new URL(req.url || "/", `${proto}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const request = new Request(url.toString(), {
    method: req.method,
    headers,
  });

  const response = await app.fetch(request);

  res.status(response.status);
  response.headers.forEach((value: string, key: string) => {
    res.setHeader(key, value);
  });
  const body = await response.text();
  res.end(body);
}
