# Változási napló

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
