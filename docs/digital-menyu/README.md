# HALO Digital Menyu — oshxona monitoridagi reklama menyu

Bu papka ChatGPT Sites'dagi `halo-digital-menu.uzbusinessman7.chatgpt.site` loyihasidan
2026-10-04 kuni olingan eksport. Fayllar ChatGPT bergan holicha, o'zgartirilmasdan saqlangan.
HALO Control'ning ishlab turgan kodiga ulanmagan — hozircha faqat saqlab qo'yilgan.

## Ichida nima bor

| Fayl | Nima |
|---|---|
| `menu-live-2026-10-04.json` | **HOZIRGI menyu** — ishlab turgan saytning `/api/menu` javobi (2026-10-04 holati): 18 taom, variantlar va narxlar, tarkibi, rasm manzillari, aksiya, SET MENU, "rahmat" ekrani, har bir monitor sozlamasi. Asosiy manba shu |
| `menu-export.json` | ESKI nusxa (2026-08-27): 17 taom. Faqat solishtirish uchun |
| `API.md` | Ekran ma'lumotni `GET /api/menu` dan oladi; javob shakli |
| `MALUMOT-TUZILMASI.md` | Taom → variantlar (nomi + narxi), aksiya, SET |
| `BOSHQARUV.md` | 3 ta ekran: `?screen=kebab`, `?screen=chicken`, `?screen=pitsa` |
| `DIZAYN.md` | Qora fon, oq matn, oltin rang; 43″ TV |
| `HALO-CONTROL-INTEGRATSIYA.md` | ChatGPT'ning ulash bo'yicha eslatmalari |
| `source-available/` | 2026-07-21 dagi ESKI kod (namuna taomlar bilan, brauzer xotirasida ishlaydi) |
| `.env.example` | Faqat sozlama nomlari, qiymatsiz |

## Muhim: eksport to'liq emas

ChatGPT o'zi yozgan (`INCOMPLETE_SOURCE_NOTICE.md`):

- Hozir monitorda ishlab turgan versiyaning kodi (server, baza, rasmlar, shriftlar) TOPILMAGAN.
- `source-available/` — iyuldagi eski namuna; hozirgi ekran bilan bir xil emas.
- `menu-export.json` — 2026-08-27 dagi eski nusxa. Hozirgi ma'lumot `menu-live-2026-10-04.json` da.
- Rasm FAYLLARI yo'q: hozirgi menyuda faqat manzillari bor (`/api/media?key=menu/...`), rasmlarning
  o'zi hali ChatGPT saytida turibdi. Taom nomlari faqat bitta tilda (koreyscha/inglizcha tarjima bo'sh).

## Hozirgi menyu avgustdagidan nimasi bilan farq qiladi

- Yangi taom: NON KABOB (chicken 8,900 · lamb 9,900 · mix 9,900 · cheese 10,900).
- PEPERONI: 12,900 → 13,900.
- TANDIR LAVASH cheese: 14,900 → 13,900.
- SWEET CHILI: 13,500 → 13,900 · 21,900 → 22,900 · 21,900 → 22,900.
- SNOW 450 g: 13,500 → 12,900.
- Chicken wings: 4 dona 4,900 → 3,900 · 8 dona 8,900 → 7,900.
- Yangi kategoriya nomi: Combo (ichida hali taom yo'q).

`menu-live-2026-10-04.json` haqida: asl javob brauzerdan nusxalanganda harflar buzilib kelgan
(· — belgilari va koreyscha matn); fayl to'g'ri UTF-8 ga tiklangan, qiymatlar o'zgartirilmagan.

## Sirlar tekshirildi (2026-10-04)

Parol, token, API kalit yo'q. Eski koddagi admin parol o'rniga `BU_YERGA_QOYILADI` yozilgan.

## HALO Control'ga ulash rejasi (hali boshlanmagan)

Maqsad: taom nomi va narxi faqat HALO Control'da yuritiladi, monitor o'sha yerdan o'qiydi.

1. **Monitor menyu sahifasi** (HALO Control ichida, rahbar uchun): ekrandagi har bir taom
   (masalan TANDIR LAVASH) va uning variantlari (chicken / lamb / mix / cheese) HALO Control
   menyusidagi taomga bog'lanadi. Narx alohida yozilmaydi — menyudagi sotuv narxidan olinadi.
   Qo'shimcha: qaysi ekranda, tartibi, ko'rinadimi, "tugadi" belgisi, aksiya va SET MENU.
2. **Boshlang'ich ma'lumot**: `menu-live-2026-10-04.json` dagi 18 taom bir marta kiritiladi; har bir
   variant qaysi taomga to'g'ri kelishini rahbar tasdiqlaydi. Narxi farq qilsa — ko'rsatiladi.
3. **Ekran sahifasi**: HALO Control'ning o'zida `/tv/kebab`, `/tv/chicken`, `/tv/pitsa`.
   Parolsiz, faqat o'qiydi; har 30–60 soniyada yangilanadi; internet uzilsa oxirgi menyu qoladi.
   Shunda ChatGPT saytiga ehtiyoj qolmaydi.
4. **Dizayn**: hozirgi ekran kodi yo'qligi uchun ko'rinishni qayta chizish kerak — buning uchun
   ishlab turgan monitorning surati yoki skrinshoti kerak bo'ladi.
