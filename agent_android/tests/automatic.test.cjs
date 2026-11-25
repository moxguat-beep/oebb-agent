"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { STATE_KEY, publicStatus, runAutomatic, sendEmail } = require("../netlify/lib/automatic.cjs");

function memoryStore() {
  let state = null;
  let version = 0;
  return {
    async getWithMetadata(key, options) {
      assert.equal(key, STATE_KEY);
      assert.equal(options.consistency, "strong");
      return state ? { data: structuredClone(state), etag: String(version) } : null;
    },
    async setJSON(key, value, options) {
      assert.equal(key, STATE_KEY);
      if ((options.onlyIfNew && state) || (options.onlyIfMatch && options.onlyIfMatch !== String(version))) {
        return { modified: false };
      }
      state = structuredClone(value);
      version += 1;
      return { modified: true, etag: String(version) };
    },
    current: () => structuredClone(state),
  };
}

const env = { RESEND_API_KEY: "test-key", EMAIL_FROM: "from@example.test", EMAIL_TO: "to@example.test" };
const start = Date.parse("2026-11-25T09:00:00Z");

test("records negative checks, emails each hour without a match, and stops after a match", async () => {
  const store = memoryStore();
  let queries = 0;
  const keys = [];
  const checkConnection = async timeout => { assert.equal(timeout, 12_000); return ++queries === 2; };
  const send = async (config, mail) => { keys.push(mail.idempotencyKey); assert.equal(config.to, env.EMAIL_TO); };
  await runAutomatic({ store, checkConnection, send, env, now: () => start });
  assert.deepEqual(publicStatus(store.current()), {
    result: "not_found", checkedAt: "2026-11-25T09:00:00.000Z", notification: null, emailError: false,
  });
  await runAutomatic({ store, checkConnection, send, env, now: () => start + 3_600_000 });
  assert.equal(store.current().result, "found");
  assert.equal(store.current().notification, "sent");
  await runAutomatic({ store, checkConnection, send, env, now: () => start + 7_200_000 });
  assert.equal(queries, 2);
  assert.deepEqual(keys, [
    "oebb-wien-trencin-2027-04-28-keine-verbindung-2026-11-25T09",
    "oebb-wien-trencin-2027-04-28",
  ]);
});

test("records provider errors as errors, not no connection", async () => {
  const store = memoryStore();
  await assert.rejects(runAutomatic({
    store, env, now: () => start,
    checkConnection: async () => { throw new Error("provider unavailable"); },
  }), /provider unavailable/);
  assert.equal(store.current().result, "error");
  assert.equal(store.current().leaseUntil, null);
});

test("email failure preserves found result and retries without another provider request", async () => {
  const store = memoryStore();
  let queries = 0;
  let sends = 0;
  const checkConnection = async () => { queries += 1; return true; };
  const send = async () => { if (++sends === 1) throw new Error("timeout"); };
  await assert.rejects(runAutomatic({ store, checkConnection, send, env, now: () => start }), /timeout/);
  assert.equal(store.current().notification, "pending");
  assert.equal(store.current().emailError, true);
  await runAutomatic({ store, checkConnection, send, env, now: () => start + 3_600_000 });
  assert.equal(queries, 1);
  assert.equal(sends, 2);
  assert.equal(store.current().notification, "sent");
  assert.equal(store.current().emailError, false);
});

test("does not resend after the idempotency window becomes unsafe", async () => {
  const store = memoryStore();
  let sends = 0;
  const send = async () => { sends += 1; throw new Error("unknown delivery"); };
  const checkConnection = async () => true;
  await assert.rejects(runAutomatic({ store, checkConnection, send, env, now: () => start }));
  await assert.rejects(runAutomatic({
    store, checkConnection, send, env, now: () => start + 23 * 3_600_000,
  }), /ungewiss/);
  assert.equal(sends, 1);
  assert.equal(store.current().notification, "attention");
});

test("missing email configuration does not lose a found connection", async () => {
  const store = memoryStore();
  await assert.rejects(runAutomatic({
    store, checkConnection: async () => true, env: {}, now: () => start,
  }), /RESEND_API_KEY/);
  assert.equal(store.current().result, "found");
  assert.equal(store.current().notification, "pending");
  assert.equal(store.current().firstEmailAttemptAt, null);
  assert.equal(store.current().emailError, true);
});

test("concurrent invocations do not perform duplicate checks or sends", async () => {
  const store = memoryStore();
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  let queries = 0;
  let sends = 0;
  const checkConnection = async () => { queries++; await paused; return true; };
  const send = async () => { sends++; };
  const first = runAutomatic({ store, checkConnection, send, env, now: () => start });
  await new Promise(resolve => setImmediate(resolve));
  await runAutomatic({ store, checkConnection, send, env, now: () => start });
  release();
  await first;
  assert.equal(queries, 1);
  assert.equal(sends, 1);
});

test("refuses corrupt stored state rather than treating it as a new search", async () => {
  const store = memoryStore();
  await store.setJSON(STATE_KEY, { result: "found" }, { onlyIfNew: true });
  await assert.rejects(runAutomatic({
    store, checkConnection: async () => assert.fail("unexpected check"), env, now: () => start,
  }), /ungültig/);
});

test("email call uses a stable idempotency key and rejects failed service responses", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(options.headers["Idempotency-Key"], "oebb-wien-trencin-2027-04-28");
    return { ok: true, json: async () => ({ id: "email-id" }) };
  });
  await sendEmail({ apiKey: "test", from: "from@example.test", to: "to@example.test" });
  fetchMock.mock.mockImplementation(async () => ({ ok: false, status: 503 }));
  await assert.rejects(sendEmail({ apiKey: "test", from: "from@example.test", to: "to@example.test" }), /503/);
});
