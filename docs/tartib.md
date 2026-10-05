# Tizim tartibi (menyu)

Rahbar ekranida bo‘limlar ikki qavatga bo‘lingan: **har kuni ishlatiladiganlar**
doim ko‘z oldida, **kam ishlatiladiganlar** “⋯ Yana” ichida turkum-turkum.

## 1. Har kuni ishlatiladigan (pastki qator / chap ustun)

| Guruh | Bo‘limlar |
| --- | --- |
| Bosh | Bosh sahifa |
| Kundalik ish | Kiritish · HALO HISOB · Kassa · Kunlik nazorat |
| Xarid va qarz | Yetkazib beruvchilar · MEZANA |
| Ombor va menyu | Ombor · Menyu |
| Xodimlar | Maosh · Vazifalar |

Telefonda guruhlar pastda, ochiq guruhning bo‘limlari tepada turadi.
Kompyuterda hammasi chap ustunda guruh sarlavhalari bilan.

## 2. Kam ishlatiladigan (“⋯ Yana” oynasi)

| Turkum | Bo‘limlar |
| --- | --- |
| 📊 Hisobot | Hisobot va zaxira · Oy yakuni sanog‘i · O‘zgarishlar tarixi |
| 🍽️ Menyu vositalari | Narx kalkulyatori · Monitor menyu · Telegram do‘kon |
| 👥 Xodimlar sozlamasi | Keldim / ketdim joyi · Akkauntlar · Xodim ilovasi |
| ⚙️ Sozlash | Filiallar · Soliq va komissiyalar · Ulanishlar |
| 🧰 Tizim | Ilovani o‘rnatish · To‘liq o‘tish · Ma’lumot ko‘chirish · Eski ko‘rinish · Chiqish |

Oynada har bo‘lim ostida bir qatorlik izoh bor. Shu bo‘limlardan biri ochiq
bo‘lsa: pastda “Yana” yoqiladi, tepada (kompyuterda — chap ustunda) shu
turkumning bo‘limlari ko‘rinadi. “Chiqish” faqat oynaning o‘zida turadi.

## Qoidalar

- Har bir bo‘lim faqat bitta joyda turadi.
- Menyudagi nom bilan sahifa sarlavhasi bir xil.
- Ro‘yxatlar bitta joyda — `app/core/ui-shell.ts`: `NAV_GROUPS` (asosiy) va
  `NAV_MORE` (kam ishlatiladigan). Yangi sahifa shu ikkisidan biriga yoziladi va
  `shell({ active })` ga o‘z kalitini beradi.
- Sahifa manzillari o‘zgarmagan; eski havolalar ishlayveradi.
- `Akkauntlar` va `Filiallar` — bitta sahifaning ikki ko‘rinishi
  (`/api/v2/sozlamalar?b=akkaunt`, `?b=filial`).
- `Keldim / ketdim joyi` — Maosh sahifasining alohida ko‘rinishi
  (`/api/v2/maosh?b=joy`).
