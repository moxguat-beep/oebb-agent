import { getStore } from "@netlify/blobs";
import automatic from "../lib/automatic.cjs";
import oebb from "../lib/oebb.cjs";

export default async (_request, context) => {
  if (!context.deploy.published) {
    console.log("Automatische Prüfung nur im veröffentlichten Deploy.");
    return;
  }
  try {
    await automatic.runAutomatic({
      store: getStore("oebb-monitor"),
      checkConnection: oebb.checkConnection,
    });
  } catch (error) {
    console.error("Automatische ÖBB-Prüfung fehlgeschlagen:", error);
    throw error;
  }
};
