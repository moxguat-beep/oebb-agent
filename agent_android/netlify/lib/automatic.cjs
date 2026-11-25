"use strict";

const STATE_KEY = "wien-trencin-2027-04-28";
const LEASE_MS = 60_000;
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

async function readState(store) {
  const entry = await store.getWithMetadata(STATE_KEY, {
    type: "json",
    consistency: "strong",
  });
  if (entry) {
    const state = entry.data;
    const validDate = value => value === null ||
      (typeof value === "string" && Number.isFinite(Date.parse(value)));
    if (!state || typeof state !== "object" || Array.isArray(state) ||
        !["never", "not_found", "found", "error"].includes(state.result) ||
        ![null, "pending", "sent", "attention"].includes(state.notification) ||
        typeof state.emailError !== "boolean" ||
        !validDate(state.checkedAt) || !validDate(state.firstEmailAttemptAt) ||
        !validDate(state.leaseUntil) ||
        (state.result === "never" && state.checkedAt !== null) ||
        (state.result !== "never" && state.checkedAt === null) ||
        (state.result === "found" ? state.notification === null : state.notification !== null)) {
      throw new Error("Gespeicherter automatischer Status ist ungültig.");
    }
  }
  return entry ? { state: entry.data, etag: entry.etag } : { state: null, etag: null };
}

async function saveState(store, state, etag) {
  const options = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
  const result = await store.setJSON(STATE_KEY, state, options);
  if (!result.modified) throw new Error("Status wurde parallel geändert; die Prüfung wird nicht fortgesetzt.");
  return result.etag;
}

function publicStatus(state) {
  if (!state) return { result: "never", checkedAt: null, notification: null, emailError: false };
  return {
    result: state.result,
    checkedAt: state.checkedAt,
    notification: state.notification,
    emailError: state.emailError,
  };
}

function emailConfig(env) {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  const to = env.EMAIL_TO?.trim();
  if (!apiKey || !from || !to) {
    throw new Error("RESEND_API_KEY, EMAIL_FROM und EMAIL_TO müssen in Netlify konfiguriert sein.");
  }
  return { apiKey, from, to };
}

async function sendEmail(config) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "oebb-wien-trencin-2027-04-28",
    },
    body: JSON.stringify({
      from: config.from,
      to: [config.to],
      subject: "ÖBB: Direktverbindung Wien–Trenčín gefunden",
      text: "Für den 28.04.2027 ist eine Direktverbindung von Wien Hbf (U) nach Trenčín im ÖBB-Fahrplan gelistet.\n\nDie Kaufbarkeit von Tickets wurde nicht geprüft.\n\nhttps://fahrplan.oebb.at/webapp/",
    }),
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`E-Mail-Dienst meldet HTTP ${response.status}.`);
  const body = await response.json();
  if (!body || typeof body.id !== "string" || !body.id) {
    throw new Error("E-Mail-Dienst lieferte keine gültige Versandbestätigung.");
  }
}

async function runAutomatic({ store, checkConnection, send = sendEmail, env = process.env, now = Date.now }) {
  let { state, etag } = await readState(store);
  const time = now();
  if (state?.notification === "sent" || state?.notification === "attention") return;
  if (state?.leaseUntil && Date.parse(state.leaseUntil) > time) return;

  state = {
    result: state?.result ?? "never",
    checkedAt: state?.checkedAt ?? null,
    notification: state?.notification ?? null,
    emailError: state?.emailError ?? false,
    firstEmailAttemptAt: state?.firstEmailAttemptAt ?? null,
    leaseUntil: new Date(time + LEASE_MS).toISOString(),
  };
  etag = await saveState(store, state, etag);

  try {
    if (state.result !== "found") {
      const checkedAt = new Date(now()).toISOString();
      try {
        const available = await checkConnection(12_000);
        state = { ...state, checkedAt, result: available ? "found" : "not_found", notification: available ? "pending" : null };
      } catch (error) {
        state = { ...state, checkedAt, result: "error", notification: null };
        etag = await saveState(store, state, etag);
        throw error;
      }
      etag = await saveState(store, state, etag);
    }

    if (state.result === "found") {
      if (state.firstEmailAttemptAt && now() - Date.parse(state.firstEmailAttemptAt) >= RETRY_WINDOW_MS) {
        state = { ...state, notification: "attention" };
        etag = await saveState(store, state, etag);
        throw new Error("E-Mail-Status ungewiss; automatische Wiederholung zur Vermeidung von Duplikaten gestoppt.");
      }
      let config;
      try {
        config = emailConfig(env);
      } catch (error) {
        state = { ...state, emailError: true };
        etag = await saveState(store, state, etag);
        throw error;
      }
      if (!state.firstEmailAttemptAt) {
        state = { ...state, firstEmailAttemptAt: new Date(now()).toISOString() };
        etag = await saveState(store, state, etag);
      }
      try {
        await send(config);
      } catch (error) {
        state = { ...state, emailError: true };
        etag = await saveState(store, state, etag);
        throw error;
      }
      state = { ...state, notification: "sent", emailError: false };
      etag = await saveState(store, state, etag);
    }
  } finally {
    await saveState(store, { ...state, leaseUntil: null }, etag);
  }
}

module.exports = { STATE_KEY, readState, publicStatus, runAutomatic, sendEmail };
