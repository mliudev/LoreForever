// Which app is asking and whether it's too old (lib/client-version.js): Willo on a PC and the iPhone app are both read,
// the routes' app check is as strict as before, and anything unreadable is served, never told to update.
// Run: node --test 'site/tests/*.test.mjs'

import { test } from "node:test";
import assert from "node:assert/strict";
import { readClient, isCompanion, tooOld, clientVersions } from "../lib/client-version.js";

test("Willo on a PC and the iPhone app are both read, with their versions", () => {
  assert.deepEqual(readClient("companion/0.25.0"), { platform: "willo", version: [0, 25, 0], valid: true });
  assert.deepEqual(readClient("companion/ios-0.2.0"), { platform: "ios", version: [0, 2, 0], valid: true });
  assert.deepEqual(readClient("companion/0.25.0-qa3").version, [0, 25, 0]);
  assert.deepEqual(readClient("companion/dev"), { platform: "willo", version: null, valid: true });
});

test("the app check stays as strict as the regexes it replaced", () => {
  for (const bad of [null, "", "companion/", "Companion/0.25.0", "companion/0.25.0 x", "mozilla/5.0", "companion/" + "1".repeat(25)])
    assert.equal(isCompanion(bad), false, String(bad));
  assert.equal(isCompanion("companion/0.25.0+1"), false);                    // no "+" in the strict routes
  assert.equal(isCompanion("companion/0.25.0+1", { loose: true }), true);    // the check-in's own pattern
  assert.equal(isCompanion("companion/" + "1".repeat(33), { loose: true }), false);
});

test("only a readable version below the minimum is too old", () => {
  const env = { WILLO_MIN: "0.26.0", IOS_MIN: "0.3.0" };
  assert.deepEqual(tooOld("companion/0.25.0", env), { platform: "willo", min: "0.26.0" });
  assert.deepEqual(tooOld("companion/ios-0.2.0", env), { platform: "ios", min: "0.3.0" });
  assert.equal(tooOld("companion/0.26.0", env), null);
  assert.equal(tooOld("companion/ios-1.0.0", env), null);
  for (const unknown of ["companion/dev", "garbage", "", undefined, "companion/ios-", "companion/ios-x"])
    assert.equal(tooOld(unknown, env), null, String(unknown));
  // A broken minimum falls back to the code's own, which no app today is below.
  assert.equal(tooOld("companion/0.2.0", { WILLO_MIN: "soon" }), null);
});

test("the version endpoint gives each app its minimum, the newest and its download", () => {
  const v = clientVersions({ IOS_DOWNLOAD: "https://apps.apple.com/app/id1" }, "v0.25.0", "https://loreforeverwow.com");
  assert.equal(v.schema, 1);
  assert.deepEqual(v.willo, { min: "0.1.0", latest: "0.25.0", download: "https://loreforeverwow.com/download/willo" });
  assert.equal(v.addon.latest, "0.25.0");
  assert.deepEqual(v.ios, { min: "0.1.0", latest: "0.1.0", download: "https://apps.apple.com/app/id1" });
  assert.equal(clientVersions({}, null).willo.latest, "0.1.0");
});
