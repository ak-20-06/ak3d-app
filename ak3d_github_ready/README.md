# AK 3D App

3D print produktionssystem til AK 3D.

## Funktioner

- Ordrer
- Emner
- Ordre status med plader og afkrydsning
- Kalender
- Printere
- Filament
- Lager
- Købsliste
- Kunder
- Faktura
- Indstillinger

## Filer

- `index.html` – appens hovedfil
- `app.js` – logik og beregninger
- `styles.css` – styling
- `supabase/schema.sql` – database-tabeller til Supabase
- `config.example.js` – eksempel på Supabase config

## Kør lokalt

Du kan åbne `index.html` direkte i browseren.

Bedre lokal test:

```bash
python3 -m http.server 5173
```

Åbn derefter:

```txt
http://localhost:5173
```

## Netlify

Publish directory:

```txt
.
```

Build command skal være tom.

## Supabase

Når databasen skal kobles på:

1. Opret Supabase projekt
2. Gå til SQL Editor
3. Kør `supabase/schema.sql`
4. Brug Project URL og anon key i appen

Gem aldrig `service_role` key i GitHub.
