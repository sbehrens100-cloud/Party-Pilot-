# PartyPilot

Vermittlungsplattform für Firmen- und Privatfeiern in Heidelberg, Mannheim und Rhein-Neckar.
Kunden geben ihre Feier ein und bekommen drei Pakete (Spar / Beliebt / Premium) aus der Dienstleister-Datenbank,
schicken eine unverbindliche Anfrage und können den Stand verfolgen. Der Admin-Bereich enthält Cockpit,
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
- Kunden bekommen über `/api/public` nur öffentliche Felder: Name, Ort, Beschreibung, Stil, Preise.
  Keine Telefonnummern, E-Mails, Adressen, Provisionen, Quellen oder Notizen.
- Begrenzung gegen Massenanfragen: Login 8 Versuche / 15 Min., Anfragen 10 / Std. pro IP.

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
