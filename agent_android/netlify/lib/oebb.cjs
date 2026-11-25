"use strict";

function buildRequest() {
  return {
    id: `web-monitor-${Date.now()}`,
    ver: "1.88",
    lang: "deu",
    // Public client identifier used by the Scotty website; not a user credential.
    auth: { type: "AID", aid: "5vHavmuWPWIfetEe" },
    client: { id: "OEBB", type: "WEB", name: "webapp", l: "vs_webapp", v: 22001 },
    formatted: false,
    ext: "OEBB.14",
    svcReqL: [{
      meth: "TripSearch",
      id: "1|1|",
      req: {
        depLocL: [{
          lid: "A=1@O=Wien Hbf (U)@X=16377950@Y=48184986@U=81@L=1290401@",
          name: "Wien Hbf (U)",
          eteId: "dep_0|S|Wien Hbf (U)|1290401|16377950|48184986",
        }],
        arrLocL: [{
          lid: "A=1@O=Trencin@X=18051850@Y=48896608@U=81@L=5600105@",
          name: "Trencin",
          globalIdL: [{ id: "5613866", type: "U" }, { id: "56TRE", type: "B" }],
          eteId: "arr_0|S|Trencin|5600105|18051850|48896608",
        }],
        minChgTime: "-1",
        liveSearch: false,
        maxChg: "0",
        jnyFltrL: [{ type: "PROD", mode: "INC", value: 15359 }],
        getPolyline: false,
        outFrwd: true,
        outTime: "000000",
        outDate: "20270428",
        getPasslist: false,
        getTariff: false,
      },
    }],
  };
}

function parseResponse(data) {
  if (!data || data.err !== "OK") {
    throw new Error(`ÖBB-Fahrplanfehler: ${data?.errTxt || data?.err || "Ungültige Antwort"}`);
  }
  if (!Array.isArray(data.svcResL) || data.svcResL.length !== 1) {
    throw new Error("Die ÖBB-Antwort enthält kein eindeutiges Suchergebnis.");
  }
  const service = data.svcResL[0];
  if (service?.meth !== "TripSearch") {
    throw new Error("Die ÖBB-Antwort enthält keine Verbindungssuche.");
  }
  if (service.err === "H890") return false;
  if (service.err !== "OK") {
    throw new Error(`ÖBB-Fahrplanfehler: ${service.errTxt || service.err || "Unbekannter Fehler"}`);
  }
  if (!Array.isArray(service.res?.outConL) ||
      service.res.outConL.some(connection => !connection || typeof connection !== "object" || Array.isArray(connection))) {
    throw new Error("Die ÖBB-Antwort enthält keine gültige Verbindungsliste.");
  }
  return service.res.outConL.length > 0;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    body: JSON.stringify(body),
  };
}

async function handler(event) {
  if (event.httpMethod !== "POST") {
    const response = jsonResponse(405, { error: "Bitte die Prüfung über den Button auf der Website starten." });
    response.headers.Allow = "POST";
    return response;
  }
  try {
    const available = await checkConnection();
    return jsonResponse(200, { available, checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error("ÖBB-Prüfung fehlgeschlagen:", error);
    const timeout = error.name === "TimeoutError";
    return jsonResponse(timeout ? 504 : 502, {
      error: timeout
        ? "ÖBB antwortet nicht rechtzeitig. Bitte später erneut versuchen."
        : "Der ÖBB-Fahrplan konnte nicht zuverlässig abgefragt werden. Bitte später erneut versuchen.",
    });
  }
}

async function checkConnection(timeoutMs = 25_000) {
  const response = await fetch(`https://fahrplan.oebb.at/gate?rnd=${Date.now()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "OEBB-Verbindungscheck/1.0",
    },
    body: JSON.stringify(buildRequest()),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`ÖBB-Fahrplan antwortet mit HTTP ${response.status}.`);
  return parseResponse(await response.json());
}

module.exports = { handler, buildRequest, parseResponse, checkConnection };
