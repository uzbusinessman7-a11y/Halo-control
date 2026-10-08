# Tizim tartibi (menyu)

Rahbar ekranida bo‘limlar ikki qavatga bo‘lingan: **har kuni ishlatiladiganlar**
doim ko‘z oldida, **kam ishlatiladiganlar** “⋯ Yana” ichida turkum-turkum.

## 1. Har kuni ishlatiladigan (pastki qator / chap ustun)

| Guruh | Bo‘limlar |
| --- | --- |
| Bosh | Bosh sahifa · Savdo kunlari |
| Kundalik ish | Kiritish · Kassa · Kunlik nazorat |
| Xarid va qarz | Yetkazib beruvchilar · MEZANA |
| Ombor va menyu | Ombor · Menyu |
| Xodimlar | Maosh · Vazifalar |

Telefonda guruhlar pastda, ochiq guruhning bo‘limlari tepada turadi.
Kompyuterda hammasi chap ustunda guruh sarlavhalari bilan.

## 2. Kam ishlatiladigan (“⋯ Yana” oynasi)

| Turkum | Bo‘limlar |
| --- | --- |
| 📊 Hisobot | Menyu tahlili · Hisobot va zaxira · Oy yakuni sanog‘i · O‘zgarishlar tarixi |
| 🍽️ Menyu vositalari | Narx kalkulyatori · Monitor menyu · Telegram do‘kon |
| 👥 Xodimlar sozlamasi | Keldim / ketdim joyi · Qat’iy ish vaqti · Akkauntlar · Xodim ilovasi · HALO HISOB |
| ⚙️ Sozlash | Filiallar · Soliq va komissiyalar · Ulanishlar |
| 🧰 Tizim | Ilovani o‘rnatish · To‘liq o‘tish · Ma’lumot ko‘chirish · Eski ko‘rinish · Chiqish |

Oynada har bo‘lim ostida bir qatorlik izoh bor. Shu bo‘limlardan biri ochiq
bo‘lsa: pastda “Yana” yoqiladi, tepada (kompyuterda — chap ustunda) shu
turkumning bo‘limlari ko‘rinadi. “Chiqish” faqat oynaning o‘zida turadi.

Rahbar savdoni «Kiritish»da kiritadi; HALO HISOB va Xodim ilovasi — xodimlar ishlatadigan oynalar, shu sabab ular
«Xodimlar sozlamasi» turkumida. Har ishning bitta yo'li bor — [bitta-yol.md](bitta-yol.md).

## Sahifa ichidagi tartib

Har bir bo‘limda ma’lumot bir xil ketma-ketlikda turadi:

1. **Asosiy raqam** — sahifaning bosh ko‘rsatkichi (jami qarz, to‘lash qolgan maosh, pul qayerda, ochiq vazifalar…).
2. **Asosiy amal** — bitta sariq tugma (📦 Yangi kirim, 🧮 Kassani sanash, ＋ Yangi vazifa…). Forma tugma
   bosilganda ochiladi — sahifani egallab turmaydi.
3. **Diqqat talab qiladigani** — yozilmagan, kutilayotgan, tekshirilmagan narsalar.
4. **Ro‘yxat** — yozuvlar; uzun ro‘yxat qisqartirib ko‘rsatiladi («yana ko‘rsatish»).
5. **Kam ishlatiladigani** — pastda, yig‘ilgan holda (bosilsa ochiladi): tarix, sozlash, hisobot matni.

| Sahifa | Raqam | Asosiy amal | Pastda (yig‘ilgan / kam ishlatiladigan) |
| --- | --- | --- | --- |
| Bosh sahifa | Savdo: bugun, kecha, oy boshidan | — | Kunlik Telegram hisobot |
| Savdo kunlari | Davr jami (POS, HALO hisob, delivery, bonus) | POS kiritilmagan kunlar | «Qanday hisoblanadi» |
| Kiritish → Xarajat | — | Xarajat kiritish | Har oy avtomatik xarajatlar · Chicken moyi (forma ostida, yig‘ilgan) |
| Kassa | Pul qayerda | Kassani sanash · O‘tkazma · Kirim | Oldingi kunlar (7 kundan eskisi) |
| Kunlik nazorat | Bugungi tekshiruv | — | Oshxona qoidalari (sozlash) |
| Yetkazib beruvchilar | Jami qarz | Yangi kirim | Shu oy kirimlari |
| Menyu | Food cost | Yangi taom | Menyu tahlili · Narx kalkulyatori havolalari |
| Maosh | To‘lash qolgan | xodim → varaqa | Xodimlar ro‘yxati va stavkalar |
| Vazifalar | Bajarilmagan vazifalar | Yangi vazifa | — |

Yig‘iladigan bo‘lak — umumiy ko‘rinish: `<section class="card fold"><details><summary><span><b>Nomi</b><small>izoh</small></span></summary>…`
(`app/core/ui-shell.ts`). Tartibni `tests/v2-sahifa-tartibi.test.mjs` qo‘riqlaydi.

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
- `Qat’iy ish vaqti` — Maosh sahifasining alohida ko‘rinishi (`?b=vaqt`), batafsil: `docs/qatiy-ish-vaqti.md`
  (`/api/v2/maosh?b=joy`).
- `Menyu tahlili` — Menyu sahifasining alohida ko‘rinishi (`/api/v2/menyu?b=tahlil`):
  qaysi taom ko‘p sotiladi, qaysi biri sotilmaydi, qaysi biri foyda keltiradi. Menyu sahifasining
  o‘zida faqat taom tannarxi va narxlar; ikkalasi bir-biriga bitta tugma bilan bog‘langan.
