# PointOut

PointOut ist ein kleines Feedback-Widget für React-Web-Apps: Screenshot des aktuellen Bildschirms, Markierungen per Maus oder Finger, Sprache-zu-Text oder Text und Absenden. Der Server-Adapter läuft im vorhandenen Backend der App. OpenAI- und Supabase-Schlüssel bleiben dort.

**Stand v0.2:** React-Client und frameworkunabhängige `Request`/`Response`-Handler, mit Beispiel für Next.js App Router und Supabase. Andere Frameworks können dieselben Handler in ihre Routen einhängen. Für rein statische Seiten ist ein Backend erforderlich. WirdEcht verwendet vorerst weiterhin seine integrierte PointOut-Fassung. Neu in v0.2: letzte Bedienschritte, Format-Angaben, Kategorie und App-Zustand für die Auswertung (siehe „Was mitgesendet wird“); keine Datenbank-Migration nötig.

## Installation aus GitHub

```sh
npm install https://github.com/hans3n21/pointout/archive/refs/tags/v0.2.0.tar.gz
```

Das Tag-Archiv enthält bereits die gebauten Dateien in `dist/`; beim Installieren ist kein Build-Schritt nötig, und es braucht keinen SSH-Schlüssel. Nicht `git+https://…#v0.2.0` verwenden: npm baut Git-Abhängigkeiten mit `build`-Skript vor dem Einbau selbst, und das scheitert. Node.js 22 oder neuer ist für den Server-Adapter erforderlich. Den festen Tag beibehalten, bis ein neuer Tag veröffentlicht wird.

### Prompt für Codex oder Claude

> Integriere PointOut v0.2.0 aus `https://github.com/hans3n21/pointout` in diese React-Web-App. Lies die README. Nutze den bestehenden App-Server und, falls vorhanden, die vorhandene OpenAI- und Supabase-Infrastruktur. Installiere das Paket aus dem GitHub-Release, binde Widget und CSS ein, richte die zwei serverseitigen Routen und die SQL-Installation ein, konfiguriere `projectId`, `projectName` und `appVersion`, und prüfe Screenshot, Markieren, Mikrofon, Text und fehlgeschlagenes Senden. Halte alle Schlüssel auf dem Server.

## Client

Die CSS-Datei einmal im App-Layout importieren und das Widget an einer Stelle rendern, die auf jeder Seite vorhanden ist:

```tsx
import "@hans3n21/pointout/style.css";
import { PointOutWidget } from "@hans3n21/pointout";

export function Feedback() {
  return <PointOutWidget projectId="meine-app" projectName="Meine App" appVersion="1.0.0" />;
}
```

`feedbackUrl` und `transcribeUrl` zeigen standardmäßig auf `/api/pointout/feedback` und `/api/pointout/transcribe`. Sie lassen sich als Props ändern. Der automatische Screenshot erfasst den sichtbaren App-Bildschirm vor dem Overlay und übernimmt lesbare Canvas-Bitmaps. Beim erneuten Öffnen wird der aktuelle Bildschirm erfasst; Textentwürfe bleiben erhalten. Manuell gewählte Bilder und Entwürfe nach einem Sendefehler bleiben erhalten. Bildauswahl ist immer verfügbar. `data-pointout-private` blendet sensible App-Elemente im automatischen Bild aus. URL-Query und Hash werden nicht übertragen.

Optional liefert die App ihren eigenen Zustand mit – das, was nur sie weiß. Die Funktion wird beim Öffnen des Dialogs ausgewertet (höchstens 1 Sekunde, Fehler werden ignoriert); Werte kurz halten und nichts Persönliches hineinschreiben:

```tsx
<PointOutWidget projectId="meine-app" projectName="Meine App"
  context={() => ({ ansicht: "Warenkorb", angemeldet: true, artikel: 3 })} />
```

`data-pointout-area="Gitarre"` an einem Bereich benennt ihn in den Bedienschritten (sonst wird ein vorhandenes `aria-label` des umgebenden Elements verwendet).

## Was mitgesendet wird

Neben Text, markiertem Screenshot und Seitenpfad:

- **Letzte Bedienschritte:** höchstens 20 aus den letzten 3 Minuten vor dem Öffnen – Klicks auf Bedienelemente mit ihrer Beschriftung, JavaScript-Fehler, fehlgeschlagene `fetch`-Anfragen (Methode, Adresse ohne Query, Status). Wiederholungen werden zusammengefasst. Nie erfasst: Tastatureingaben, Feldinhalte, Anfrage- und Antwortinhalte, alles in `data-pointout-private`. Die Schritte liegen nur im Arbeitsspeicher, erscheinen im Dialog („Letzte Schritte mitsenden“) und lassen sich dort einzeln entfernen oder ganz abschalten.
- **Gerät und Format:** Browser, Betriebssystem, Gerätetyp, Fenster- und Bildschirmgröße, Pixeldichte, Touch, App-Modus, Ausrichtung, Seitenverhältnis, Farbschema, Sprache, Scroll-Position. Für Auswertende: Das ist der Ort, an dem ein Problem auffiel – eine Lösung muss in allen Formaten funktionieren.
- **Kategorie:** Fehler, Idee oder Design, wenn gewählt (`bug`, `idea`, `design`, sonst `general`).
- **App-Zustand:** was die App über `context` liefert.

Kategorie, Schritte, App-Zustand und Format stehen in der Spalte `metadata`. Für öffentliche Apps gehört ein Satz in die Datenschutzerklärung, etwa: „Wenn du Feedback sendest, übermitteln wir deinen Text, auf Wunsch einen Screenshot, technische Gerätedaten und die letzten Bedienschritte ohne deine Eingaben.“ (Keine Rechtsberatung.)

## Server in einer Next.js-App mit Supabase

1. `supabase/install.sql` als neue, geprüfte Migration in der **Supabase-Instanz der App** anwenden. Die Datei legt `pointout_feedback`, einen privaten Storage-Bucket und eine persistente Rate-Limit-Funktion an. Bestehende `feedback`-Tabellen werden nicht verändert. Falls die Supabase Data API neue Tabellen/Funktionen nicht automatisch freigibt, nur für `service_role` exponieren.
2. Server-Variablen setzen: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `POINTOUT_RATE_LIMIT_SECRET` (zufällige Zeichenfolge mit mindestens 16 Zeichen). Ein vorhandener OpenAI-Client kann stattdessen als `transcribe`-Funktion übergeben werden. Niemals `SUPABASE_SERVICE_ROLE_KEY` oder `OPENAI_API_KEY` mit `NEXT_PUBLIC_` versehen.
3. Einen gemeinsamen Handler erstellen. Der gezeigte Rate-Limit-Schlüssel setzt eine **globale Obergrenze pro App**, auch ohne Nutzerkonto. Bei mehr Verkehr zusätzlich einen vertrauenswürdigen Nutzer-/Sitzungsschlüssel aus der App verwenden. Browser-Header ungeprüft als Identität zu verwenden, erlaubt Umgehungen.

```ts
// src/lib/pointout-server.ts — nur serverseitig importieren
import { createClient } from "@supabase/supabase-js";
import { createOpenAITranscriber, createPointOutHandlers, createSupabaseRateLimiter, createSupabaseStore } from "@hans3n21/pointout/server";

export function pointOutHandlers() {
  const projectId = "meine-app";
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return createPointOutHandlers({
    projectId,
    store: createSupabaseStore(supabase),
    rateLimit: createSupabaseRateLimiter(supabase, {
      projectId,
      secret: process.env.POINTOUT_RATE_LIMIT_SECRET!,
      identify: () => "app-wide-budget",
      feedbackPerHour: 120,
      transcriptionsPerHour: 60,
    }),
    transcribe: createOpenAITranscriber(process.env.OPENAI_API_KEY!),
  });
}
```

```ts
// src/app/api/pointout/feedback/route.ts
import { pointOutHandlers } from "@/lib/pointout-server";
export const runtime = "nodejs";
export async function POST(request: Request) { return pointOutHandlers().feedback(request); }
```

```ts
// src/app/api/pointout/transcribe/route.ts
import { pointOutHandlers } from "@/lib/pointout-server";
export const runtime = "nodejs";
export async function POST(request: Request) { return pointOutHandlers().transcribe(request); }
```

Die Rate-Limit-Funktion blockiert bei Datenbankfehlern. Der Dialog behält Text und Bild bei einem Sendefehler, damit der Nutzer erneut senden kann. Feedback-Zeilen sind nur dem Server zugänglich; für eine Admin-Oberfläche muss die App ihre vorhandene Admin-Authentifizierung verwenden. Screenshots liegen im privaten Bucket, `screenshot_url` enthält einen Bucket-Pfad. Für die Anzeige signierte URLs nur in einem geschützten Admin-Endpunkt erzeugen.

## Prüfen

```sh
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

In der eingebauten App Desktop Chrome, Chrome auf Android und Safari auf iPhone prüfen: Screenshot mit Canvas, Markierung und Zwei-Finger-Zoom, Mikrofon erlaubt/verweigert, manueller Bildersatz, Transkriptionsfehler und Offline-Senden. Mikrofonzugriff erfordert HTTPS oder localhost. Browser-Screenshots können Video, fremde iFrames, geschützte Canvas-Inhalte und SVGs mit externen Masken unvollständig erfassen; die manuelle Bildauswahl ist der sichere Ausweichweg. Eine frühere WirdEcht-Meldung zu einer externen SVG-Maske ist noch als eigener Capture-Fix offen.

## Späterer Homeserver

Ein Homeserver ist sinnvoll, wenn mehrere Apps denselben Feedback-Posteingang, eine zentrale OpenAI-Konfiguration und gemeinsame Limits nutzen sollen. Die Widget-Props `feedbackUrl` und `transcribeUrl` erlauben diesen Weg später. Für die erste Version vermeidet der App-eigene Server zusätzliche Verfügbarkeit, Authentifizierung und Datenspeicherung außerhalb der App.
