# Tizim tartibi (menyu guruhlari)

Rahbar ekranida barcha bo‘limlar oltita guruhga bo‘lingan. Telefonda guruhlar
pastda, ochiq guruhning bo‘limlari tepada turadi. Kompyuterda hammasi chap
ustunda guruh sarlavhalari bilan ko‘rinadi. Eski “⋯ Yana” ro‘yxati yo‘q.

| Guruh | Bo‘limlar |
| --- | --- |
| Bosh va hisobot | Bosh sahifa · Hisobot va zaxira · Oy yakuni sanog‘i · O‘zgarishlar tarixi |
| Kundalik ish | Kiritish · HALO HISOB · Kassa · Kunlik nazorat |
| Xarid va qarz | Yetkazib beruvchilar · MEZANA |
| Ombor va menyu | Ombor · Menyu · Narx kalkulyatori · Monitor menyu · Telegram do‘kon |
| Xodimlar | Maosh · Vazifalar · Keldim / ketdim joyi · Akkauntlar · Xodim ilovasi |
| Sozlash | Filiallar · Soliq va komissiyalar · Ulanishlar · Ilovani o‘rnatish · To‘liq o‘tish · Ma’lumot ko‘chirish · Eski ko‘rinish · Chiqish |

Qoidalar:

- Har bir bo‘lim faqat bitta guruhda turadi.
- Menyudagi nom bilan sahifa sarlavhasi bir xil.
- Guruhlar ro‘yxati bitta joyda — `app/core/ui-shell.ts` ichidagi `NAV_GROUPS`.
  Yangi sahifa qo‘shilsa, shu ro‘yxatga yoziladi va sahifa `shell({ active })`
  ga o‘z kalitini beradi.
- Sahifa manzillari o‘zgarmagan; eski havolalar ishlayveradi.
- `Akkauntlar` va `Filiallar` — bitta sahifaning ikki ko‘rinishi
  (`/api/v2/sozlamalar?b=akkaunt`, `?b=filial`).
- `Keldim / ketdim joyi` — Maosh sahifasining alohida ko‘rinishi
  (`/api/v2/maosh?b=joy`).
