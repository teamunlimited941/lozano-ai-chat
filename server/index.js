import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = Fastify({ logger: true });

// Serve /widget.js (and any other assets you later add) from server/public
await app.register(fastifyStatic, {
  root: join(__dirname, "public"),
  prefix: "/", // so /widget.js is served at the root
  cacheControl: true,
});

// Health
app.get("/health", async () => ({ ok: true, ts: Date.now() }));

const port = Number(process.env.PORT || 8787);
app.listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`API up on :${port}`))
  .catch((e) => { console.error(e); process.exit(1); });
