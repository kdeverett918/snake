const { createAppServer } = require("./server");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const server = createAppServer({ rootDir: __dirname });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/healthz`);
    assert(health.status === 200, `GET /healthz expected 200, got ${health.status}`);
    assert((await health.text()) === "ok", "GET /healthz expected body 'ok'");

    const home = await fetch(`${base}/`);
    assert(home.status === 200, `GET / expected 200, got ${home.status}`);
    assert((home.headers.get("content-type") || "").includes("text/html"), "GET / expected text/html");
    const homeBody = await home.text();
    assert(homeBody.includes('canvas id="game"'), "index.html should include game canvas");

    const js = await fetch(`${base}/game.js`);
    assert(js.status === 200, `GET /game.js expected 200, got ${js.status}`);
    const jsType = js.headers.get("content-type") || "";
    assert(jsType.includes("javascript") || jsType.includes("text/javascript"), "GET /game.js expected JS content-type");
    const jsBody = await js.text();
    assert(jsBody.includes("Gravity Snake"), "game.js should load (sanity check)");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

