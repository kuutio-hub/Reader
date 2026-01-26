# Változási napló

## [0.10.9-beta] - 2024-07-27

### Jelentős Javítások és Új Funkciók
- **Témakezelés és Stílus:**
  - Teljes, konzisztens színpaletták lettek bevezetve minden témához (Világos, Sötét, Szépia, Mátrix), amelyek a gombokra és menükre is kiterjednek.
  - A "Mátrix" téma mostantól az olvasófelület teljes szövegtörzsére is érvényesül.
  - A felhasználók mostantól egyedileg felülbírálhatják a betű- és háttérszínt, a beállítások elmentődnek.
- **Tipográfia:**
  - Bővült a választható betűtípusok listája (pl. Georgia, Open Sans, Times New Roman).
  - Új csúszka a betűk vastagságának (font-weight) állításához.
- **Navigáció és Állapotkezelés:**
  - A "Vissza" gomb mostantól pontosan arra a sorra ugrik vissza, ahonnan egy belső linkre kattintottunk. Csak ilyen esetekben jelenik meg.
  - Az alkalmazás megjegyzi az utolsó olvasási pozíciót (fejezet és görgetési helyzet), és kilépés után onnan folytatja a könyvet.
- **Haladáskövetés:**
  - A fejlécben lévő százalékos kijelző és a folyamatjelző sáv mostantól a teljes könyvön belüli pontos pozíciót tükrözi, kiküszöbölve a fejezetváltáskor tapasztalt pontatlanságokat.
  - A fejezetcím kijelzése a fejlécben reszponzívabb lett.
- **Képkezelés:**
  - A könyvben lévő képekre kattintva azok nagyítható, teljes képernyős nézetben (lightbox) jelennek meg.
  - A képek méretezése független lett a szöveg margóinak állításától, így mindig konzisztens méretűek.

## [0.6.0-beta] - 2024-05-24

### Kritikus Javítások
- **ePub Constructor Hiba:** Javítva a `TypeError: window.ePub is not a constructor` hiba, amely a "Single File" környezetben jelentkezett. A script betöltése és inicializálása mostantól szigorúbban ellenőrzött.

### Új Funkciók (Beállítások)
- **Tipográfia:** Választható betűtípusok (Inter, Merriweather, Roboto Mono), sorkizárt igazítás opció, sorköz és betűköz állítás.
- **Téma és Minták:** Egyedi színválasztók mellett mostantól háttér textúrák (papír, vonalas, zaj) is bekapcsolhatók.
- **Kétoldalas Nézet:** Új "2 Oldal" opció a lapozáshoz, amely kényszeríti a könyv dupla oldalas megjelenítését (főleg asztali nézetben hasznos).
- **Egyoldalas Nézet:** Választható görgetés vagy lapozás az egyoldalas nézethez.

### UX Javítások
- **Navigáció:** Megnövelt, láthatatlan érzékeny területek (jobb/bal 15%) a könnyebb lapozáshoz.
- **Billentyűzet:** Nyíl gombokkal való lapozás támogatása.

## [0.5.0-beta] - 2024-05-24
*Single File Architecture bevezetése.*
