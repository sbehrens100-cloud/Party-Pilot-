# PartyPilot

Vermittlungsplattform für Firmen- und Privatfeiern in Heidelberg, Mannheim und Rhein-Neckar.
Kunden wählen zuerst groß an, was sie brauchen (Location, Catering, Getränke, DJ, Foto, Deko, Personal), geben die Eckdaten ein
und sehen ihre Feier als Flussdiagramm. Zu jedem Punkt wählen sie die Art (z. B. Buffet, Menü, BBQ), Extras (z. B. Chafing Dishes,
Fassbier) bzw. die Anzahl Helfer und danach den Anbieter mit Bildern, Räumen und Preis. Spar / Beliebt / Premium gibt es als Vorschlag.
Danach schicken sie eine unverbindliche Anfrage und können den Stand verfolgen. Der Admin-Bereich enthält Cockpit,
Anfragen & Event-Akten (9 Stufen mit Checklisten), Dienstleister-Datenbank, Gewinnrechnung und Einstellungen.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `public/index.html` | Die komplette App (Kundenansicht + Admin), lädt und speichert über die API |
| `server/server.js` | Node-Server ohne externe Pakete: liefert die App aus, API, Login, Speicherung |
| `server/seed.js` | Start-Datenbank (39 Betriebe), wird nur beim allerersten Start übernommen |
| `railway.json` | Start-Befehl und Healthcheck für Railway |

## Daten & Sicherheit

- Alle Daten liegen in `partypilot-db.json` im Ordner `DATA_DIR` (auf Railway das Volume unter `/data`).
  Vor jedem Speichern wird `partypilot-db.json.bak` angelegt, dazu ein Tages-Backup in `/data/backups` (30 Tage).
- Admin-Login mit Passwort (scrypt-Hash) und HttpOnly-Session-Cookie (30 Tage).
- Kunden bekommen über `/api/public` nur öffentliche Felder: Name, Ort, Beschreibung, Stil, Preise, Bilder, Räume, Angebot (Optionen).
  Keine Telefonnummern, E-Mails, Adressen, Provisionen, Quellen oder Notizen.
- Begrenzung gegen Massenanfragen: Login 8 Versuche / 15 Min., Anfragen 10 / Std. pro IP.

## Optionen & Bilder

- Der Options-Katalog je Kategorie steht in `public/index.html` (`OPTS`): Art (`styles`, mit Preisfaktor), Extras (`extras`, mit Richtpreis) und Rollen beim Personal.
- Je Dienstleister: `opts` (was er anbietet), `optPrice` (eigene Preise je Option), `imgs` (Bilder), bei Locations `rooms` (Name, ab/bis Personen, Beschreibung, Bild).
- Bilder werden im Admin hochgeladen, im Browser verkleinert und unter `DATA_DIR/media` gespeichert (`/media/...`). Bilder für die Optionen pflegt der Admin unter Einstellungen.
- Beim Start ergänzt der Server fehlende Felder bei bestehenden Dienstleistern (Startwerte aus `server/seed.js`, markiert mit „Angebot/Optionen“ unter „Zu prüfen“).

## Variablen (Railway)

| Variable | Zweck |
|---|---|
| `ADMIN_PASSWORD` | Admin-Passwort beim ersten Start. Danach im Admin unter Einstellungen änderbar. |
| `ADMIN_PASSWORD_RESET` | Auf `1` setzen, um das Passwort wieder auf `ADMIN_PASSWORD` zurückzusetzen (danach wieder entfernen). |
| `DATA_DIR` | Speicherort, Standard: Volume-Pfad von Railway bzw. `./data` |

## Lokal starten

```bash
npm run dev   # http://localhost:8080, Passwort: test-passwort-123
```

## Offline-Demo als einzelne Datei

`node tools/build-standalone.js <public.json> PartyPilot.html` baut die Kundenansicht als eine HTML-Datei mit eingebetteten Beispielbildern. `public.json` ist die Antwort von `GET /api/public` (nur öffentliche Felder, keine Kontakte oder Provisionen). Anfragen bleiben in der Demo nur im Browser, den Admin-Bereich gibt es dort nicht.
