// server/index.js
import Fastify from "fastify";
const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true, ts: Date.now() }));

// log every request so we see it in Railway logs
app.addHook("onRequest", async (req) => {
  app.log.info({ method: req.method, url: req.url }, "incoming");
});

const port = Number(process.env.PORT || 8080);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API up on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
