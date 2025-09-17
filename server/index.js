import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the widget file once at startup
const widgetJs = readFileSync(join(__dirname, "public", "widget.js"), "utf8");

const app = Fastify({ logger: true });

// Health
app.get("/health", async () => ({ ok: true, ts: Date.now() }));

// Serve the widget
app.get("/widget.js", async (req, reply) => {
  reply.header("Content-Type", "application/javascript; charset=utf-8");
  reply.send(widgetJs);
});

const port = Number(process.env.PORT || 8787);
app.listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`API up on :${port}`))
  .catch((e) => { console.error(e); process.exit(1); });
