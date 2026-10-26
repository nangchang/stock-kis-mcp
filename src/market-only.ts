import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { createServer } from "./index.js";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await createServer("market").connect(new StdioServerTransport());
}
