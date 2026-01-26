# Változási napló

## [0.13.0-beta] - 2024-07-29

### Jelentős Javítások és Új Funkciók
- **Felhasználói Felület Tisztítása:**
  - Az olvasó nézetből eltávolításra került a százalékos haladásjelző és a felső folyamatjelző sáv a zavartalanabb olvasási élmény érdekében. A haladás továbbra is nyomon követhető a könyv részletes adatlapján.
- **Intelligens "Vissza" Gomb:**
  - A korábbi, fix "Vissza" gomb helyett egy új, lebegő gomb jelent meg, amely csak belső linkre (pl. lábjegyzet) kattintás után jelenik meg a képernyő alján, és pontosan visszanavigál az előző olvasási pozícióra.
- **Tökéletesített "Terminál" Téma:**
  - A téma mostantól egyetlen, konzisztens neonszínt használ minden elemre (szöveg, menük, kiemelések).
  - A "Beállítások" panelen egy új színválasztó jelent meg, amellyel a Terminál téma neonszíne szabadon beállítható. Ez a választó csak a Terminál téma aktív állapotában látható.
- **Kiemelő Rendszer Refaktorálása:** A kiemelések színkezelése át lett alakítva, hogy támogassa a téma-alapú és egyedi színeket, megalapozva a Terminál téma egységesítését.

## [0.12.0-beta] - 2024-07-29

### Kritikus Javítások
- **STABILITÁS:** Kijavítva egy kritikus hiba, amely miatt az alkalmazás hibaüzenet nélkül megállt a töltőképernyőn ("csendes hiba").
  - Az indítási folyamat mostantól egy robusztus hibakezelőben fut, amely bármilyen hiba esetén egyértelmű üzenetet és újratöltési lehetőséget jelenít meg a felhasználónak.
  - Az adatbázis-kapcsolat (IndexedDB) kezelése stabilabbá vált, hogy megelőzze a más böngészőfülek által okozott esetleges blokkolásokat és lefagyásokat.

## [0.10.9-beta] - 2024-07-27
- **Témakezelés és Stílus:** Teljes, konzisztens színpaletták minden témához.
- **Tipográfia:** Bővített betűtípus-választék és vastagság-állítás.
- **Navigáció és Állapotkezelés:** Pontos "Vissza" gomb és olvasási pozíció megjegyzése.
- **Haladáskövetés:** Pontosabb, könyv-szintű haladásjelzés.
- **Képkezelés:** Képek nagyítása (lightbox).

## [0.6.0-beta] - 2024-05-24
- **Tipográfia és Témák:** Betűtípusok, igazítás, sorköz, háttértextúrák bevezetése.

## [0.5.0-beta] - 2024-05-24
*Single File Architecture bevezetése.*
