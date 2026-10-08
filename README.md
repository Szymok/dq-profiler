# DQ Profiler

Profil jakości danych z pliku CSV, liczony w całości w przeglądarce. Wgrywasz plik, wskazujesz, co jest wymagane i jakie reguły sprawdzić, i dostajesz raport z semaforem (zielony od 95%, żółty 85–95%, czerwony poniżej 85%).

Projekt jest w trakcie budowy. Działa pełny przepływ w przeglądarce (wczytanie, ustawienia, raport, pobranie HTML i JSON). Nie jest jeszcze wdrożony na stronie skszymon.eu.

## Prywatność

- Plik jest czytany lokalnie (`File.arrayBuffer`) i nigdy nie jest wysyłany.
- Zbudowana wersja zawiera politykę Content-Security-Policy z `connect-src 'none'`: przeglądarka sama odrzuca każde połączenie sieciowe z tej strony (fetch, XHR, WebSocket, beacon). Obietnica „dane nie opuszczają przeglądarki" jest więc wymuszona, a nie tylko zadeklarowana.
- Raport jest wyświetlany w ramce z `sandbox` (bez skryptów). Nazwy kolumn i wartości z pliku są wstawiane jako tekst lub escapowane, nigdy jako HTML.
- Raport HTML jest samodzielnym plikiem: wbudowane style, bez skryptów i bez zewnętrznych zasobów (poza jednym linkiem do oferty).
- Przykłady błędnych wartości w raporcie można wyłączyć przed udostępnieniem.
- Te właściwości pilnują testy w przeglądarce (`e2e/privacy.e2e.ts`): brak żądań sieciowych po wybraniu pliku, zbudowaniu i pobraniu raportu; blokada `fetch`, `sendBeacon` i `WebSocket` przez CSP (sprawdzana zdarzeniami naruszenia polityki, bo `sendBeacon` i `WebSocket` same nie zgłaszają błędu); złośliwe nazwy kolumn i wartości nie wykonują się.

## Co mierzy

Trzy z sześciu wymiarów jakości danych. Raport mówi o tym wprost.

| Wymiar | Miara |
|---|---|
| Kompletność | Wypełnione pola wymagane i w pełni kompletne rekordy. Za brak uznaje puste pole, spacje oraz `-`, `--`, `---`, `n/d`, `n/a`, `brak`, `NULL`. Obsługuje kompletność warunkową („NIP wymagany, gdy typ = firma"). |
| Unikalność | Duplikaty klucza (wybrane kolumny) albo identyczne wiersze, gdy klucza nie wskazano. |
| Ważność | Reguły: e-mail (kształt), NIP (10 cyfr z sumą kontrolną), kod pocztowy `00-000`, telefon polski (9 cyfr, opcjonalnie +48), data nie z przyszłości, zakres liczbowy. Puste wartości są pomijane, bo mierzy je kompletność. |

Wynik łączny to prosta średnia ze zmierzonych wymiarów. Wymiar, którego nie da się zmierzyć przy danej konfiguracji, jest oznaczony „nie zmierzono", a nie 100%.

Poza zakresem (obecnie): dokładność, spójność między źródłami, aktualność; formaty inne niż polskie dla NIP, telefonu i kodu pocztowego; pliki `.xlsx`.

## Ograniczenia

- **Limit pliku: 25 MB.** Zużycie pamięci jest rzędu 17 razy większe niż rozmiar pliku (patrz pomiary), więc większe pliki mogą zawiesić kartę na słabszym sprzęcie.
- Kodowanie: UTF-8, w razie błędu Windows-1250. Separator (`,` `;` tabulator `|`) jest wykrywany i można go zmienić ręcznie.
- Parser działa na całym tekście w głównym wątku (bez strumieniowania i Web Workera). Podczas wczytywania strona na chwilę przestaje reagować.
- Walidacja formatu nie dowodzi, że wartość istnieje (poprawny kształt e-maila nie znaczy, że skrzynka działa).

## Pomiary wydajności

Przeglądarka Chromium w aplikacji desktopowej, zbudowana wersja z CSP, jedna maszyna (Windows 11). Dane syntetyczne, 10 kolumn, z cytatami w polach, brakami, wartościami zastępczymi i błędnymi formatami. Limit sterty JS na tej maszynie: ok. 4,2 GB.

| Plik | Wczytanie i profil | Liczenie raportu | Razem | Sterta JS |
|---|---|---|---|---|
| ok. 10 MB (66 tys. wierszy), 3 próby | 551–692 ms | 105–121 ms | 655–809 ms | – |
| 15,1 MB (100 tys. wierszy) | 1199 ms | 162 ms | 1,36 s | – |
| 49,5 MB (328 tys. wierszy; wiersze powtórzone celowo) | 3621 ms | 1583 ms | 5,2 s | 835–870 MB |

Wnioski:
- Kryterium projektu („10 MB w mniej niż 5 s") jest spełnione z dużym zapasem.
- Czas rośnie liniowo z rozmiarem pliku.
- Pamięć jest ograniczeniem ważniejszym niż czas, stąd limit 25 MB (ok. 430 MB sterty przy 17-krotnym narzucie).

Zastrzeżenia: jedna maszyna i jedna przeglądarka, plik 50 MB zmierzony jednokrotnie, brak testów na słabszym sprzęcie i na telefonach. Wartości w danych testowych są mało zróżnicowane, co może zaniżać koszt zbioru unikalnych wartości. Liczby orientacyjne, nie gwarancja.

## Uruchomienie

```bash
npm install
npm run dev        # serwer deweloperski (bez CSP)
npm test           # testy jednostkowe (Vitest)
npm run typecheck  # kontrola typów
npm run test:e2e   # testy w przeglądarce (Playwright), na zbudowanej wersji z CSP
npm run build      # build produkcyjny do dist/ (z CSP)
npm run release    # build + dist/VERSION (wersja, commit, sumy SHA-256 plików)
npx vite preview   # podgląd zbudowanej wersji (http://localhost:4173)
```

Build używa ścieżek względnych (`base: "./"`), więc można go osadzić pod dowolną ścieżką.

### Testy na wdrożonej kopii

Te same testy zachowania i prywatności można uruchomić na adresie, pod którym narzędzie jest opublikowane (końcowy `/` jest ważny):

```bash
E2E_BASE_URL=https://skszymon.eu/assets/tools/dq-profiler/ npm run test:e2e
```

Testy statyczne budowy (`e2e/build.e2e.ts`) są wtedy pomijane, bo wymagają katalogu `dist/`.

### Wydanie i osadzenie na stronie

0. Końce linii są wymuszone na LF przez `.gitattributes` (niezależnie od `core.autocrlf`), bo Vite zachowuje je w `dist/index.html`, a manifest zapisuje sumy SHA-256. Bez tego ten sam commit dawał różne bajty na Windowsie i Linuksie.
1. Zacommituj zmiany (manifest oznacza niezacommitowany stan jako `DIRTY`).
2. Oznacz wersję tagiem (`git tag vX.Y.Z`) i uruchom `npm run release`.
3. Skopiuj zawartość `dist/` (razem z `VERSION`) do miejsca hostingu. Strona skszymon.eu trzyma kopię w `assets/tools/dq-profiler/` i sprawdza sumy z `VERSION` testem.

Aplikacja jest osobnym dokumentem bez analityki i śledzenia, ze ścisłym CSP. Nie osadzaj jej w stronie z własnymi skryptami analitycznymi ani z nagrywaniem sesji: nagranie mogłoby przechwycić dane z pliku. Testy `e2e/build.e2e.ts` pilnują, żeby w buildzie nie było kodu analitycznego ani adresów spoza dozwolonej listy (`skszymon.eu`, `github.com`, jako zwykłe linki).

## Struktura

```
src/
  csv.ts         parser CSV, wykrywanie separatora, dekodowanie UTF-8 / Windows-1250
  profile.ts     profil kolumn: braki, typy, unikalne wartości, zakresy, duplikaty wierszy
  validators.ts  e-mail, NIP, kod pocztowy, telefon
  rules.ts       reguły ważności i podpowiedzi reguł
  report.ts      raport: kompletność (także warunkowa), unikalność, ważność, semafor
  export.ts      eksport JSON i samodzielny HTML
  settings.ts    ustawienia z interfejsu -> konfiguracja raportu
  main.ts        interfejs (czysty TypeScript, bez frameworka)
  fixtures/      syntetyczne dane testowe
e2e/             testy w przeglądarce (Playwright): prywatność, zachowanie, statyczna kontrola buildu
scripts/         manifest.mjs: dist/VERSION z commitem i sumami SHA-256
```

Testy odtwarzają liczby opublikowane we wpisie „Kompletność danych w SQL" (76,8% pól wymaganych, 41,7% kompletnych rekordów) na tych samych 12 wymyślonych rekordach. Wszystkie dane testowe są syntetyczne, numery NIP są wymyślone i celowo nie przechodzą sumy kontrolnej.

## Plan

Plan, zasady i pre-mortem: `docs/dq-profiler-plan.md` w repozytorium strony skszymon.eu. Do zrobienia: integracja ze stroną, CI (uruchamianie testów jednostkowych i e2e przy każdym pushu).

## Licencja

MIT, zobacz plik `LICENSE`.
