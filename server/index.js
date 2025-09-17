import Fastify from "fastify";

const app = Fastify({ logger: true });

// health
app.get("/health", async () => ({ ok: true, ts: Date.now() }));

// simple request log
app.addHook("onRequest", async (req, reply) => {
  app.log.info({ method: req.method, url: req.url }, "incoming");
});

// catch-all (so we don't 404 while testing)
app.all("/*", async (req, reply) => {
  if (req.url === "/health") return; // handled above
  return { ok: true, at: new Date().toISOString(), path: req.url };
});

const port = Number(process.env.PORT || 8080);
app.listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`API up on :${port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
