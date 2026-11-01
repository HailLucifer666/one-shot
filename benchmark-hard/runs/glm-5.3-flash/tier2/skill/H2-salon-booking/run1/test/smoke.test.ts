import test from "node:test";
import assert from "node:assert/strict";
import { startTestServer, url } from "./helpers/http.ts";

test("health endpoint responds ok", async () => {
  const ts = await startTestServer();
  try {
    const res = await fetch(url(ts.port, "/health"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    ts.close();
  }
});
