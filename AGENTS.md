# AK3D app – instruktioner til Codex

Dette er en simpel statisk HTML/CSS/JS app hostet på GitHub Pages.

## Vigtige filer
- index.html = layout og alle tabs
- app.js = al logik, beregninger, localStorage og Supabase client
- styles.css = styling og print/faktura CSS
- config.js = Supabase URL og publishable anon key
- assets/logo/ak3d-logo.png = logo

## Regler
- Slet ikke funktioner uden at erstatte dem.
- Bevar dansk UI.
- Bevar alle id'er som bruges i app.js.
- Undgå at flytte rundt på store dele af HTML uden grund.
- Appen skal virke på mobil og PC.
- Ingen build step. Det er ren statisk frontend.
- Test altid at menu-knapper stadig virker.
- Test console for errors.
- Brug ikke secret Supabase key. Kun publishable/anon key.

## Kendte vigtige ID'er
Navigation bruger:
- .navbtn
- data-tab
- section id="tab-..."

Emner bruger:
- itemsBody
- itemCustomQty
- itemWeightPlate
- itemFilamentType
- itemPiecesPerPlate
- itemMultPerUnit
- itemPlateHours
- itemPlateMinutes

Faktura bruger:
- invoiceBody
- showUnitPriceOnInvoice
- invTotalEx
- invMomsAmount
- invTotalInc

Indstillinger bruger:
- setPowerPrice
- setDefaultWatt
- setMoms
- setMargin
- setSwitchMin
- setWear
- setLaborRate
- setDefaultHours

## Typiske fejl der skal undgås
- Brug ikke variablen `it` udenfor `.map(it => ...)`.
- Brug ikke `tbody.innerHTML` før `const tbody = byId(...)`.
- Sørg for at faktura-tabellen bruger `invoiceBody`.
- Sørg for at emne-tabellen bruger `itemsBody`.
- Sørg for at `<main>` ligger efter `</aside>`, ikke inde i aside.
Codex bruger AGENTS.md som repo-specifik vejledning, blandt andet til hvordan den skal arbejde og reviewe ændringer.
