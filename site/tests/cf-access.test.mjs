import test from "node:test";
import assert from "node:assert/strict";
import { accessHeaders } from "../../scripts/cf-access.mjs";

// LOR-493: scripts present the Cloudflare Access service token only when both halves are set.
test("scripts send the Access service token only when both values are set", () => {
  assert.deepEqual(accessHeaders(() => undefined), {});
  assert.deepEqual(accessHeaders(n => ({ CF_ACCESS_CLIENT_ID: "id.access" })[n]), {}, "one half alone sends nothing");
  assert.deepEqual(accessHeaders(n => ({ CF_ACCESS_CLIENT_ID: " ", CF_ACCESS_CLIENT_SECRET: "s" })[n]), {});
  assert.deepEqual(accessHeaders(n => ({ CF_ACCESS_CLIENT_ID: "id.access", CF_ACCESS_CLIENT_SECRET: "s3cret\r" })[n]),
    { "CF-Access-Client-Id": "id.access", "CF-Access-Client-Secret": "s3cret" });
});
