import { getStore } from "@netlify/blobs";
import automatic from "../lib/automatic.cjs";

export default async (request) => {
  if (request.method !== "GET") {
    return Response.json({ error: "Nur GET wird unterstützt." }, {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "no-store" },
    });
  }
  try {
    const { state } = await automatic.readState(getStore("oebb-monitor"));
    return Response.json(automatic.publicStatus(state), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Automatischer Status konnte nicht gelesen werden:", error);
    return Response.json({ error: "Der automatische Status ist momentan nicht verfügbar." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
};
