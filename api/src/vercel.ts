/**
 * Vercel serverless function entry point.
 * Vercel calls `app.fetch` directly via the Web Fetch API —
 * no Node HTTP server adapter is needed here.
 */
import app from "./index";

export default app.fetch;
