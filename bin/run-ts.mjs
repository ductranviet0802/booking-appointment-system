// Runs a TypeScript entry (seed, batch CLI) outside Next, with the "@/" alias of tsconfig.json.
// Usage: node bin/run-ts.mjs <path from repo root> [args…]
import { createJiti } from "jiti";

const root = new URL("../", import.meta.url).pathname;
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
await jiti.import(root + process.argv[2]);
