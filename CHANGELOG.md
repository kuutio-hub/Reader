# Változási napló

## [1.0.0] - 2024-05-24

### Átépítés (Refactor)

- **Single File Architecture:** A teljes alkalmazás (`js`, `css`, `html`) egyetlen `index.html` fájlba lett integrálva. Ez megszünteti a GitHub Pages-en jelentkező elérési út (`pathing`) és betöltési hibákat.
- **Könyvtár-központú Nézet:** Az alkalmazás mostantól a Könyvtár nézettel indul, nem próbál meg automatikusan megnyitni egy nem létező könyvet.

### Hozzáadva (Added)

- **Könyv Részletek Modális Ablak:** A borítóra kattintva egy részletes információs ablak nyílik meg (Cím, Szerző, Leírás, Gombok), nem indul el azonnal az olvasás.
- **Gyorsítótár Ürítése:** A beállítások menüben elérhető a "Gyorsítótár és könyvek törlése" gomb, ami mindent alaphelyzetbe állít.
- **Leírás (Blurb) Támogatás:** Importáláskor az alkalmazás elmenti és megjeleníti a könyv leírását (ha az EPUB tartalmazza).

### Javítva (Fixed)

- **Verziószám Láthatósága:** A verziószám (`1.0.0`) egy `fixed` pozíciójú láblécbe került, így mindig látható.
- **Navigáció:** A menük és gombok logikája egyszerűsödött. A TOC (tartalomjegyzék) csak olvasás közben érhető el, a bal oldali sávból.

## [0.4.0] - 2024-05-24
*Legacy verziók archiválva.*
