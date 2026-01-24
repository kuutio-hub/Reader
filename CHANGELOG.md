# Változási napló

Minden jelentős változás ebben a fájlban lesz dokumentálva. A formátum a [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) elvein alapul.

## [0.3.1] - 2024-05-23

### Javítva (Fixed)

- **Kritikus inicializálási hiba:** Javítva egy hiba, ami miatt az alkalmazás a "Könyv betöltése..." képernyőn ragadt. Az indító logika egy felesleges `DOMContentLoaded` eseményfigyelőt tartalmazott, ami a szkript betöltési sorrendje miatt soha nem futott le. Az eseményfigyelő eltávolításával az alkalmazás mostantól megbízhatóan elindul.
- **Kódstruktúra:** Az `app.js` kódja egyetlen, tiszta objektum-literállá lett refaktorálva a jobb olvashatóság és karbantarthatóság érdekében.

## [0.3.0] - 2024-05-23

### Hozzáadva (Added)

- **Kódstruktúra Refaktorálás:** A CSS és JavaScript logika különálló `style.css` és `app.js` fájlokba lett szervezve a jobb karbantarthatóság érdekében.
- **Olvasási Folyamat Mentése:** Az alkalmazás mostantól automatikusan menti az olvasó pozícióját minden könyvben, és a könyv újbóli megnyitásakor onnan folytatja az olvasást.
- **Keresés a Könyvben:** Új "Keresés" panel a bal oldali sávban, amely lehetővé teszi a teljes könyv szövegében való keresést és a találatokra ugrást.
- **Szövegfelolvasás (Text-to-Speech):** A felső sávban új vezérlők jelentek meg (Lejátszás/Szünet/Leállítás), amelyekkel felolvastatható az aktuális oldal tartalma a böngésző beépített hangján.
- **Lábléc:** Az alkalmazás aljára egy diszkrét lábléc került, ami a copyright évet és az aktuális verziószámot jeleníti meg.

### Módosítva (Changed)

- Az `index.html` jelentősen egyszerűsödött, már csak a HTML vázat és a külső fájlokra való hivatkozásokat tartalmazza.
- A JavaScript kód modulárisabb lett az új `search` és `tts` objektumok bevezetésével.
- A felső navigációs sáv kibővült a "Keresés" menüponttal.

## [0.2.1] - 2024-05-22

### Javítva (Fixed)

- **Kritikus indulási hiba javítása:** Javítva egy időzítési hiba (`race condition`), ami miatt az alkalmazás a külső `epub.js` könyvtár betöltődése előtt próbált elindulni. Egy ellenőrző mechanizmus került beépítésre, ami megvárja a könyvtár elérhetőségét, így stabilizálva az indulást. Ezzel a `window.ePub is not a constructor` hiba megszűnt.
- **Adatbázis-műveletek:** Implementálva lettek a hiányzó IndexedDB (`saveBook`, `getBook`, `getAllBooks`) metódusok, megelőzve a jövőbeli adatkezelési hibákat.
- **Kódminőség:** Eltávolításra kerültek redundáns, hibás kódrészletek a fő szkriptből a jobb karbantarthatóság érdekében.

## [0.2.0] - 2024-05-22

### Hozzáadva (Added)

- **Funkcionális Könyvtár:**
  - A könyvek rácsos nézetben jelennek meg a bal oldali sáv "Könyvtár" paneljén.
  - Automatikus borítókép-kinyerés és megjelenítés importáláskor.
  - A könyvtár nézetből közvetlenül megnyithatók a könyvek.
- **Könyvkezelés:**
  - "Könyv adatai" modális ablak, amely megjeleníti a könyv metaadatait.
  - "Könyv törlése" funkció megerősítéssel, ami eltávolítja a könyvet az IndexedDB-ből.
- **Részletes Beállítások Modális Ablak:**
  - Füles elrendezés: "Megjelenés", "Elrendezés", "Adatkezelés".
  - **Megjelenés:**
    - Előredefiniált témák (OLED, Szépia, Világos).
    - Egyedi színválasztók a szövegnek és a háttérnek.
    - Új sliderek a sorköz (line-height) és betűköz (letter-spacing) állítására.
  - **Elrendezés:**
    - Olvasási mód váltása "Lapozás" és "Görgetés" között.
  - **Adatkezelés:**
    - "Gyorsítótár ürítése" gomb az összes tárolt könyv törlésére.

### Módosítva (Changed)

- Az `Epubly` JavaScript objektum jelentősen kibővítve az új funkciók logikájával (`library`, `settings`, `ui` modulok).
- Az `IndexedDB` tárolás mostantól a könyv metaadatait és a borítóképét is menti a gyorsabb könyvtár-renderelés érdekében.
- A felhasználói felület (UI) finomhangolva az új modális ablakok és vezérlők integrálásához.

## [0.1.0] - 2024-05-21

### Hozzáadva (Added)

- **Teljes EPUB Olvasó Prototípus Létrehozása (Prompt_1)**
- **Architektúra:** Egyfajlos `index.html` architektúra beágyazott, moduláris JavaScripttel és CSS-sel a `Prompt_0` szerint.
- **Vizuális Rendszer:** Ultra-prémium, OLED-fekete és arany témájú dizájn implementálása CSS változókkal.
- **EPUB Renderelés:** Valós EPUB fájlok betöltése, feldolgozása és megjelenítése a `epub.js` könyvtár segítségével.
- **Adattárolás:** Könyvek tárolása a böngésző IndexedDB-jében a perzisztencia érdekében.
- **Felhasználói Felület:** Lebegő felső sáv, oldalsávok, modális ablakok, Zen Mód.
- **Olvasói Beállítások:** Működő betűméret és margó állítási lehetőség.
- **Verziókezelés:** `version.js` és `CHANGELOG.md` fájlok létrehozása.
