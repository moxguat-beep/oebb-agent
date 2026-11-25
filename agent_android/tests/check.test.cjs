"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handler, parseResponse } = require("../netlify/lib/oebb.cjs");

function response(service) {
  return { err: "OK", svcResL: [{ meth: "TripSearch", ...service }] };
}

test("distinguishes found journeys, empty results and explicit no-connection response", () => {
  assert.equal(parseResponse(response({ err: "OK", res: { outConL: [{ date: "20270428" }] } })), true);
  assert.equal(parseResponse(response({ err: "OK", res: { outConL: [] } })), false);
  assert.equal(parseResponse(response({ err: "H890" })), false);
});

test("never turns provider errors or malformed responses into negative journey results", () => {
  for (const data of [
    null,
    { err: "VERSION" },
    { err: "OK", svcResL: [] },
    { err: "OK", svcResL: [null] },
    response({ err: "H895" }),
    response({ err: "OK", res: {} }),
    response({ err: "OK", res: { outConL: "invalid" } }),
    response({ err: "OK", res: { outConL: [null] } }),
    response({ err: "OK", meth: "LocMatch", res: { outConL: [] } }),
  ]) {
    assert.throws(() => parseResponse(data));
  }
});

test("endpoint requests the configured day and direct-only search and returns fresh results", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).origin, "https://fahrplan.oebb.at");
    assert.equal(options.method, "POST");
    const query = JSON.parse(options.body).svcReqL[0].req;
    assert.equal(query.maxChg, "0");
    assert.equal(query.outDate, "20270428");
    assert.equal(query.outTime, "000000");
    assert.match(query.depLocL[0].lid, /L=1290401@/);
    assert.match(query.arrLocL[0].lid, /L=5600105@/);
    return { ok: true, json: async () => response({ err: "H890" }) };
  });
  const result = await handler({ httpMethod: "POST" });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  const body = JSON.parse(result.body);
  assert.equal(body.available, false);
  assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
});

test("endpoint rejects GET without querying the provider", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected provider request"));
  const result = await handler({ httpMethod: "GET" });
  assert.equal(result.statusCode, 405);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("modern function wrapper preserves the manual endpoint response", async () => {
  const { default: check } = await import("../netlify/functions/check.mjs");
  const response = await check(new Request("https://example.test/.netlify/functions/check"));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.match((await response.json()).error, /Button/);
});

test("endpoint surfaces upstream errors and timeouts without an availability result", async (t) => {
  t.mock.method(console, "error", () => {});
  const fetchMock = t.mock.method(globalThis, "fetch");
  for (const [implementation, expectedStatus] of [
    [async () => ({ ok: false, status: 503 }), 502],
    [async () => { throw new DOMException("Timeout", "TimeoutError"); }, 504],
    [async () => ({ ok: true, json: async () => { throw new SyntaxError("Not JSON"); } }), 502],
  ]) {
    fetchMock.mock.mockImplementation(implementation);
    const result = await handler({ httpMethod: "POST" });
    assert.equal(result.statusCode, expectedStatus);
    const body = JSON.parse(result.body);
    assert.equal(typeof body.error, "string");
    assert.equal("available" in body, false);
  }
});
