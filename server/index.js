import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true, ts: Date.now() }));

const port = Number(process.env.PORT || 8787);
app.listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`API up on :${port}`))
  .catch((e) => { console.error(e); process.exit(1); });
