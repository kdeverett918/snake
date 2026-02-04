const { createAppServer } = require("./server");

const port = Number(process.env.PORT) || 8000;
const host = "0.0.0.0";

const server = createAppServer({ rootDir: __dirname });
server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Gravity Snake running on http://${host}:${port}`);
});

