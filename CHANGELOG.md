# Változási napló

## [0.15.5-beta] - 2024-07-31

### Stabilitási Javítások (Kritikus)
- **Betöltési Hiba Javítva:** Az alkalmazás induláskor már nem fagy le a betöltő képernyőn. Az adatbázis-kapcsolat egy időkorláttal lett ellátva, ami megakadályozza a végtelen várakozást és hiba esetén egyértelmű üzenetet ad.
- **Könyv Részletező Javítva:** Kijavítva a hiba, ami miatt nem lehetett megnyitni a könyvek információs ablakát a könyvtárból.
- **Nyomtatás Javítva:** A "Támogatás" szekcióban a REpont kártya nyomtatása gomb ismét működik.

## [0.15.4-beta] - 2024-07-31

### Mobil UI & Fejléc (Strukturális Átalakítás)
- **Adaptív Fejléc:** A fejléc teljesen át lett alakítva. Mobilon egy letisztult burger menü foglalja magában az összes funkciógombot, megszüntetve a korábbi elrendezési hibákat és a zsúfoltságot.
- **Súgó (Mobil):** A navigációs gombok helyét egy natív, ujjbarát lenyíló menü vette át a tökéletes használhatóság érdekében.
- **Könyv Előnézet (Mobil):** A "Könyv törlése" gomb egy helytakarékos menübe került. A fülszöveg tördelése javítva, garantáltan nem lóg ki a kijelzőről.

## [0.15.3-beta] - 2024-07-30

### Mobil UI & Stabilitás (Kritikus Javítások)
- **Burger Menü Javítás:** A mobil fejlécben a burger menü frissítés utáni működésképtelensége és az ikonok elcsúszása javítva.
- **Optimalizált Betűméret:** Az alkalmazás mobilon automatikusan nagyobb, kényelmesebb alap betűmérettel indul.
- **Súgó Ablak (Mobil):** A navigációs sáv átalakítva függőleges listává a jobb használhatóság érdekében.
- **Import Szöveg (Mobil):** A "húzd ide a fájlt" utasítás mobil nézetben eltávolítva.
- **Könyv Előnézet (Mobil):** A felugró ablak elrendezése teljesen mobilbarát lett, a leírás alapból rejtett.
