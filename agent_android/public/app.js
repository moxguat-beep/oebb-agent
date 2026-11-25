"use strict";

const button = document.querySelector("#check-button");
const result = document.querySelector(".result");
const title = document.querySelector("#result-title");
const message = document.querySelector("#result-message");
const checkedAt = document.querySelector("#checked-at");
const automaticResult = document.querySelector("#automatic-result");
const automaticCheckedAt = document.querySelector("#automatic-checked-at");

function formatVienna(date) {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Vienna",
  }).format(new Date(date));
}

async function loadAutomaticStatus() {
  try {
    if (location.protocol === "file:") {
      throw new Error("Der automatische Status ist nur auf der veröffentlichten Netlify-Seite verfügbar.");
    }
    const response = await fetch("/.netlify/functions/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Der automatische Status ist momentan nicht verfügbar.");
    const data = await response.json();
    if (!["never", "not_found", "found", "error"].includes(data.result) ||
        (data.result !== "never" && (typeof data.checkedAt !== "string" || !Number.isFinite(Date.parse(data.checkedAt)))) ||
        ![null, "pending", "sent", "attention"].includes(data.notification) ||
        typeof data.emailError !== "boolean" ||
        (data.result === "found" && data.notification === null)) {
      throw new Error("Der automatische Status ist ungültig.");
    }
    if (data.result === "never") automaticResult.textContent = "Noch keine automatische Abfrage durchgeführt.";
    if (data.result === "not_found") automaticResult.textContent = "Noch keine Direktverbindung gelistet. Die Suche läuft weiter.";
    if (data.result === "error") automaticResult.textContent = "Die letzte automatische Abfrage ist fehlgeschlagen. Die Suche wird erneut versucht.";
    if (data.result === "found") {
      automaticResult.textContent = data.notification === "sent"
        ? "Direktverbindung gefunden. Die E-Mail wurde zum Versand übergeben; die automatische Suche ist beendet."
        : data.notification === "attention"
          ? "Direktverbindung gefunden. E-Mail-Status ungewiss: Bitte den Versand im Resend-Dashboard prüfen."
          : data.emailError
            ? "Direktverbindung gefunden. E-Mail-Versand fehlgeschlagen: Bitte Konfiguration und Netlify-Logs prüfen. Die Fahrplansuche ist beendet."
            : "Direktverbindung gefunden. Die E-Mail-Benachrichtigung steht noch aus; die Fahrplansuche ist beendet.";
    }
    automaticCheckedAt.textContent = data.checkedAt ? `Letzte Abfrage: ${formatVienna(data.checkedAt)} Uhr (Wien)` : "";
  } catch (error) {
    console.error("Automatischer Status konnte nicht geladen werden:", error);
    automaticResult.textContent = error.message;
    automaticCheckedAt.textContent = "";
  }
}

loadAutomaticStatus();

button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "Fahrplan wird geprüft …";
  result.setAttribute("aria-busy", "true");
  result.dataset.state = "loading";
  title.textContent = "Einen Moment bitte.";
  message.textContent = "Die aktuelle Auskunft wird direkt bei ÖBB angefragt.";
  checkedAt.textContent = "";

  try {
    if (location.protocol === "file:") {
      throw new Error("Bitte die veröffentlichte Netlify-Adresse öffnen. Eine lokale HTML-Datei kann die Fahrplanfunktion nicht ausführen.");
    }
    const response = await fetch("/.netlify/functions/check", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(40_000),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error("Die Fahrplanfunktion fehlt. Bitte die Website einschließlich Netlify Functions veröffentlichen (siehe Anleitung).");
    }
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Die Fahrplanabfrage ist fehlgeschlagen.");
    }
    if (typeof data.available !== "boolean" ||
        typeof data.checkedAt !== "string" ||
        !Number.isFinite(Date.parse(data.checkedAt))) {
      throw new Error("Die Fahrplanfunktion hat ein ungültiges Ergebnis geliefert.");
    }
    result.dataset.state = data.available ? "found" : "not-found";
    title.textContent = data.available ? "Direktverbindung gefunden!" : "Noch keine Direktverbindung gelistet.";
    message.textContent = data.available
      ? "Für deine Strecke ist am 28.04.2027 eine Direktverbindung im Fahrplan eingetragen. Tickets werden nicht geprüft."
      : "Für den 28.04.2027 wurde keine Direktverbindung gefunden. Du kannst später erneut prüfen.";
    checkedAt.textContent = `Geprüft: ${formatVienna(data.checkedAt)} Uhr (Wien)`;
  } catch (error) {
    console.error("Fahrplanprüfung fehlgeschlagen:", error);
    result.dataset.state = "error";
    title.textContent = "Prüfung nicht möglich.";
    message.textContent = error.name === "TimeoutError"
      ? "Die Abfrage dauert zu lange. Bitte versuche es erneut."
      : error.message;
  } finally {
    result.removeAttribute("aria-busy");
    button.disabled = false;
    button.textContent = "Erneut prüfen →";
  }
});
