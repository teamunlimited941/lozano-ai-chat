import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = Fastify({ logger: true });

// serve /widget.js from server/public
app.register(fastifyStatic, {
  root: join(__dirname, "public"),
  prefix: "/", // so /widget.js works
  cacheControl: true,
});

// health
app.get("/health", async () => ({ ok: true, ts: Date.now() }));

const port = Number(process.env.PORT || 8080); // keep this matching your Railway port
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API up on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
