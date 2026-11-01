import { resolve } from "node:path";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const outboxDir = resolve(process.env.OUTBOX_DIR ?? "./outbox");

const app = createApp({ dataDir, outboxDir });
app.listen(port, () => {
  console.log(`Cutwell booking listening on http://localhost:${port}`);
  console.log(`  database: ${dataDir}`);
  console.log(`  outbox:   ${outboxDir}`);
});
