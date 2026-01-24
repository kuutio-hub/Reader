# Változási napló

Minden jelentős változás ebben a fájlban lesz dokumentálva. A formátum a [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) elvein alapul.

## [0.1.0] - 2024-05-21

### Hozzáadva (Added)

- **Teljes EPUB Olvasó Prototípus Létrehozása (Prompt_1)**
- **Architektúra:** Egyfájlos `index.html` architektúra beágyazott, moduláris JavaScripttel és CSS-sel a `Prompt_0` szerint.
- **Vizuális Rendszer:** Ultra-prémium, OLED-fekete és arany témájú dizájn implementálása CSS változókkal.
- **EPUB Renderelés:** Valós EPUB fájlok betöltése, feldolgozása és megjelenítése a `epub.js` könyvtár segítségével.
  - Támogatás helyi fájlok (`<input type="file">`) és távoli URL-ek számára.
  - Tartalomjegyzék (TOC) generálása és navigáció.
  - Lapozás (előre/hátra) billentyűzettel és egérrel.
- **Adattárolás:** Könyvek tárolása a böngésző IndexedDB-jében a perzisztencia érdekében.
- **Felhasználói Felület:**
  - Lebegő, áttetsző felső navigációs sáv.
  - Összecsukható bal oldali oldalsáv a tartalomjegyzéknek és könyvtárnak.
  - Rejtett jobb oldali oldalsáv (placeholder).
  - Modális ablakok importáláshoz és beállításokhoz.
  - Zen Mód a zavartalan olvasásért.
- **Olvasói Beállítások:** Működő betűméret és margó állítási lehetőség.
- **Verziókezelés:** `version.js` és `CHANGELOG.md` fájlok létrehozása a projekt követelményei szerint.
