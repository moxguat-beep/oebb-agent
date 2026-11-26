import { getStore } from "@netlify/blobs";
import automatic from "../lib/automatic.cjs";
import oebb from "../lib/oebb.cjs";

const viennaHour = new Intl.DateTimeFormat("de-AT", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Vienna" });

export default async (_request, context) => {
  if (!context.deploy.published) {
    console.log("Automatische Prüfung nur im veröffentlichten Deploy.");
    return;
  }
  const hour = Number(viennaHour.format(new Date()));
  if (hour < 7 || hour > 21) return;
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
