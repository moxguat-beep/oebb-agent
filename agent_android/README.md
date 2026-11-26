# ÖBB-Verbindungscheck: Website und automatische Prüfung

Der Agent prüft den ÖBB-Fahrplan auf eine Direktverbindung **Wien Hbf (U) –
Trenčín am 28.04.2027**. Er prüft die Fahrplanlistung, nicht die Kaufbarkeit
von Tickets. Die Website behält den Button **Jetzt prüfen** und zeigt zusätzlich
das Ergebnis und die Zeit der letzten automatischen Prüfung.

Die Netlify Scheduled Function startet stündlich, auch wenn Website, Handy und
PC ausgeschaltet sind. Der Cron-Ausdruck `0 * * * *` verwendet UTC; weil jede
volle Stunde ausgeführt wird, entspricht dies auch jeder vollen Stunde in
Wien, einschließlich Sommerzeit. Auf der Website wird `Europe/Vienna`
verwendet.

Solange keine Direktverbindung gefunden wird, schickt der Agent bei jedem
stündlichen Lauf eine E-Mail „keine Verbindung im Moment“. Bei einem Treffer
stoppt er die automatischen **ÖBB-Fahrplanabfragen** und übergibt eine
E-Mail mit dem Treffer an Resend. Netlify startet die Scheduled Function
weiterhin stündlich; sie liest dann nur den gespeicherten Status und beendet
sich. Eine Annahme durch Resend bedeutet nicht zwingend, dass die E-Mail im
Posteingang zugestellt wurde. Die manuelle Prüfung bleibt unabhängig nutzbar.

## Einrichten und veröffentlichen

Benötigt werden ein Netlify-Konto, ein Resend-Konto und Node.js 22.12 oder
neuer. Der Versand erfordert in der Regel eine bei Resend verifizierte
Absenderdomain mit passenden DNS-Einträgen. Resends Testabsender
`onboarding@resend.dev` ist nur zum Testversand an die eigene
Resend-Konto-E-Mail geeignet; für andere Empfänger eine eigene Domain
verifizieren. Prüfe die jeweils aktuellen Bedingungen bei Resend.

1. **E-Mail einrichten:** Bei [Resend](https://resend.com/) anmelden, unter
   **Domains** bei Bedarf eine Domain hinzufügen und die angegebenen
   DNS-Einträge setzen. Nach erfolgreicher Verifizierung eine Absenderadresse
   dieser Domain festlegen, z. B. `OEBB Monitor <monitor@deine-domain.at>`.
   Unter **API Keys** einen API-Schlüssel erstellen. Den Schlüssel geheim
   halten und nicht in Dateien oder Git speichern.
2. **Projekt auf Netlify anlegen:** Auf [Netlify](https://app.netlify.com/)
   anmelden und ein neues Projekt erstellen oder das bereits bestehende
   Projekt dieser Website verwenden. Am einfachsten ist ein Git-Import:
   dieses Verzeichnis als Repository-Wurzel oder, wenn es in einem größeren
   Repository liegt, `agent_android` als Basisverzeichnis konfigurieren. Die
   Datei `netlify.toml` legt `public`, Functions und den Zeitplan fest. Ein
   eigener Build-Befehl ist nicht nötig; Netlify installiert die Abhängigkeiten
   aus `package.json` beim Git-Build.
3. **Variablen setzen:** In Netlify unter **Project configuration →
   Environment variables** folgende Variablen für den Produktionskontext
   anlegen. Falls Scopes auswählbar sind, muss **Functions** enthalten sein.

   | Name | Wert |
   | --- | --- |
   | `RESEND_API_KEY` | der geheime Resend-API-Schlüssel |
   | `EMAIL_FROM` | die verifizierte Resend-Absenderadresse |
   | `EMAIL_TO` | `viktor@kotal.at` |

   Die E-Mail-Adresse und der API-Schlüssel gehören nicht in `netlify.toml`
   oder in das öffentliche Repository. Änderungen an Variablen benötigen ein
   neues Produktions-Deploy. Wenn beim ersten Deploy die Variablen noch nicht
   gesetzt waren, diese ergänzen und erneut deployen.
4. **Veröffentlichen:** Den Git-Deploy ausführen bzw. nach dem Setzen der
   Variablen unter **Deploys** ein neues Produktions-Deploy auslösen. Alternativ
   mit Node.js und der Netlify CLI in diesem Ordner:

   ```powershell
   npm install
   npx netlify-cli login
   npx netlify-cli link
   npx netlify-cli deploy --prod
   ```

   Bei `link` das zuvor angelegte Netlify-Projekt auswählen. Der CLI-Deploy
   benötigt die lokal installierten Abhängigkeiten. Ein reiner
   Drag-and-drop-Upload von `public` reicht nicht, da dabei die Functions
   fehlen.
5. **Prüfen:** In Netlify unter **Functions** muss `scheduled-check` als
   Scheduled Function erscheinen. Nur das veröffentlichte Produktions-Deploy
   läuft automatisch. Über **Run now** kann die Funktion einmal gestartet
   werden; das ist eine echte Fahrplanabfrage und sendet bei einem Treffer
   tatsächlich die E-Mail. Die Website öffnen und Datum, Uhrzeit und Ergebnis
   kontrollieren; **Jetzt prüfen** separat testen. In den Function-Logs
   stehen Fehlerdetails. Prüfe auch Resends Versandübersicht und den
   Spam-Ordner.

## Fehler und doppelte Benachrichtigungen

- Der Status wird dauerhaft als Netlify Blob gespeichert und über Deploys
  hinweg beibehalten. Die Status-API gibt keine E-Mail-Adresse oder
  Zugangsdaten zurück. Die Seite selbst ist ohne separate Zugangssicherung
  öffentlich; wer ihre Adresse kennt, kann den Suchstatus sehen und die
  manuelle Abfrage starten.
- Ein fehlgeschlagener Fahrplanabruf wird als Fehler angezeigt, nicht als
  „keine Verbindung“. Beim nächsten Termin wird erneut geprüft.
- Bei „keine Verbindung“ wird pro Prüfung eine Mail mit eigenem
  Idempotenzschlüssel (Prüfzeitpunkt) gesendet; ein Fehler dabei erscheint in den
  Netlify-Logs. Ein Run-now innerhalb derselben Stunde wie ein geplanter Lauf
  kollidiert dadurch nicht mit Resend (HTTP 409).
- Bei einem Treffer wird der Status vor dem E-Mail-Versuch gespeichert;
  weitere Termine fragen ÖBB nicht erneut ab. Bei E-Mail-Fehlern erfolgen
  Wiederholungen mit einem festen Resend-Idempotenzschlüssel, um doppelte
  Nachrichten zu vermeiden. Resend bewahrt diesen Schlüssel nur 24 Stunden
  auf. Nach 23 Stunden ohne bestätigte Übernahme stoppt der Agent deshalb
  vorsichtshalber die Versandversuche und zeigt einen ungeklärten Status.
  Prüfe dann die Versandübersicht bei Resend und die Netlify-Logs, bevor du
  einen Versand manuell veranlasst. Im Grenzfall eines Abbruchs ist keine
  garantierte Zustellung möglich.
- Fehlen die E-Mail-Variablen, zeigt die Website einen Versandfehler; nach
  Korrektur und erneutem Deploy wird der Versand beim nächsten Termin
  versucht. Ändere Absender oder Empfänger nicht während laufender
  Wiederholungsversuche: Resend erwartet zum Idempotenzschlüssel dieselben
  Versanddaten. Es gibt keinen öffentlichen Zurücksetzen-Knopf; das Löschen
  des Blobs startet die Suche erneut und kann eine weitere E-Mail verursachen.
- Wenn ein Fehler verhindert, den Status zu speichern, kann die Website nur
  den zuletzt gespeicherten Stand zeigen. In diesem Fall Netlify-Logs prüfen.
  Öffentliche Status- und manuelle Funktionsaufrufe verbrauchen ebenfalls
  Ressourcen.
- Netlify und Resend verarbeiten für diese Funktion Daten außerhalb der
  Website; Netlify Functions verwenden standardmäßig die Region Ohio.

## Kostenloser Tarif

Laut [Netlify-Dokumentation](https://docs.netlify.com/build/functions/scheduled-functions/)
sind Scheduled Functions auf allen Tarifen verfügbar; pro Lauf gelten
maximal 30 Sekunden. Der [Free-Tarif](https://www.netlify.com/pricing/)
umfasst derzeit 300 Credits pro Monat. Bei 1 GB Standard-Speicher und
höchstens 744 stündlichen Läufen à 30 Sekunden ergeben sich rechnerisch
höchstens etwa **62 Compute-Credits pro Monat** für diese geplante Funktion,
zuzüglich anderer Projekt- und Kontonutzung (z. B. Deploys und manuelle
Aufrufe). Ein erfolgreiches Produktions-Deploy kostet derzeit 15 Credits.
Tatsächliche Laufzeit und Abrechnung können abweichen; Nutzung im
Netlify-Konto beobachten. Bei Erreichen des Free-Limits werden alle Projekte
des Kontos pausiert. Bei älteren Netlify-Legacy-Tarifen gelten andere
Grenzen; den eigenen Tarif im Konto prüfen.

[Resend Free](https://resend.com/pricing) umfasst derzeit 3.000 E-Mails pro
Monat und 100 pro Tag. Eine Benachrichtigung passt normalerweise hinein.
Ein eigenes Konto und gegebenenfalls eine eigene Domain sind erforderlich;
eine Domain kann separat Kosten verursachen. Anbieterbedingungen und Limits
können sich ändern. Ohne eingerichtete Konten, Veröffentlichung und
Versandtest ist die Funktion noch nicht produktiv.

## Lokale Tests

Im Verzeichnis `agent_android`:

```powershell
npm install
npm test
```

Die Tests simulieren ÖBB, E-Mail und den Statusspeicher; sie versenden keine
Nachricht. Das direkte Öffnen von `public\index.html` zeigt die Oberfläche,
aber die Netlify Functions funktionieren nur über Netlify bzw. Netlify Dev.
Das Kotlin-Quellprojekt unter `app` und der Windows-Agent im übergeordneten
Ordner bleiben unverändert.
