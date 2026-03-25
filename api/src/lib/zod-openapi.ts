// This file extends zod with OpenAPI before any schemas are created.
// All schema files in api/ should import from this file instead of directly from "zod"
import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export { z };
