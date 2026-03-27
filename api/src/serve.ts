import { serve } from "@hono/node-server";
import app from "./index";

const port = Number(process.env.PORT) || 3001;

console.log(`Starting OboApp Public API on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`OboApp Public API running at http://localhost:${port}`);
