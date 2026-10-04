# HALO Digital Menyu — oshxona monitoridagi reklama menyu

Bu papka ChatGPT Sites'dagi `halo-digital-menu.uzbusinessman7.chatgpt.site` loyihasidan
2026-10-04 kuni olingan eksport. Fayllar ChatGPT bergan holicha, o'zgartirilmasdan saqlangan.
HALO Control'ning ishlab turgan kodiga ulanmagan — hozircha faqat saqlab qo'yilgan.

## Ichida nima bor

| Fayl | Nima |
|---|---|
| `menu-export.json` | Monitordagi menyu: 3 kategoriya (Kebab, Chicken, Pitsa), 17 taom, variantlar va narxlar, HALO COMBO aksiyasi, SET MENU |
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
- `menu-export.json` — 2026-08-27 dagi nusxa. Undan keyin o'zgargan narx yoki taom bu yerda yo'q.
- Rasmlar yo'q (`imageFile` hamma joyda bo'sh), taom nomlari faqat bitta tilda.

## Sirlar tekshirildi (2026-10-04)

Parol, token, API kalit yo'q. Eski koddagi admin parol o'rniga `BU_YERGA_QOYILADI` yozilgan.

## HALO Control'ga ulash rejasi (hali boshlanmagan)

Maqsad: taom nomi va narxi faqat HALO Control'da yuritiladi, monitor o'sha yerdan o'qiydi.

1. **Monitor menyu sahifasi** (HALO Control ichida, rahbar uchun): ekrandagi har bir taom
   (masalan TANDIR LAVASH) va uning variantlari (chicken / lamb / mix / cheese) HALO Control
   menyusidagi taomga bog'lanadi. Narx alohida yozilmaydi — menyudagi sotuv narxidan olinadi.
   Qo'shimcha: qaysi ekranda, tartibi, ko'rinadimi, "tugadi" belgisi, aksiya va SET MENU.
2. **Boshlang'ich ma'lumot**: `menu-export.json` dagi 17 taom bir marta kiritiladi; har bir
   variant qaysi taomga to'g'ri kelishini rahbar tasdiqlaydi. Narxi farq qilsa — ko'rsatiladi.
3. **Ekran sahifasi**: HALO Control'ning o'zida `/tv/kebab`, `/tv/chicken`, `/tv/pitsa`.
   Parolsiz, faqat o'qiydi; har 30–60 soniyada yangilanadi; internet uzilsa oxirgi menyu qoladi.
   Shunda ChatGPT saytiga ehtiyoj qolmaydi.
4. **Dizayn**: hozirgi ekran kodi yo'qligi uchun ko'rinishni qayta chizish kerak — buning uchun
   ishlab turgan monitorning surati yoki skrinshoti kerak bo'ladi.
