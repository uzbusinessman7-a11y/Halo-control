# Monitor menyu — televizordagi reklama menyu (HALO Control ichida)

Oshxonadagi 3 ta televizor (Kebab, Chicken, Pitsa) menyusi. **Yangi dizayn emas**: ko‘rinishi eski
`halo-digital-menu…chatgpt.site` saytidagi bilan aynan bir xil, faqat ma’lumot HALO Control’dan olinadi.

## Qanday ishlaydi

```
HALO Control (menyudagi taom narxi)  ─┐
                                      ├─►  /api/v2/tv  (faqat o‘qiydi, parolsiz)  ─►  televizor
Monitor menyu (rasm, tartib, yozuv)  ─┘
```

| Nima | Qayerda turadi |
|---|---|
| Taom narxi | HALO Control menyusi (`app_state.recipes[].salePrice`) — **bitta joyda**. Variant menyudagi taomga bog‘langan bo‘lsa, ekranda o‘sha narx chiqadi |
| Ekranga oid ma’lumot: sarlavha, TYPE/SIZE yozuvlari, tarkib, rasm, belgi (NEW), tartib, qaysi ekran, «sotildi», yashirish, SET MENU, kun aksiyasi, vaqtlar | alohida jadval `v2_digital_menu` (har filialga bitta yozuv) |
| Rasmlar | alohida jadval `v2_digital_menu_media` |

Monitor menyu savdo, ombor, kassa va retseptlarga **hech narsa yozmaydi** — faqat narxni o‘qiydi.

## Manzillar

| Manzil | Nima |
|---|---|
| `/menu?screen=kebab` · `chicken` · `pitsa` | Televizor sahifasi (eski saytdagi `?screen=…` bilan bir xil). Qisqasi: `/tv/kebab`. Boshqa filial: `&branch=<filial>` |
| `/api/v2/tv?data=1&screen=kebab&rev=…` | Ekran uchun tayyor menyu. `rev` hozirgi nusxa bilan bir xil bo‘lsa — faqat belgi va server vaqti qaytadi |
| `/api/v2/tv?menu=1&screen=kebab` | Menyu oddiy JSON ko‘rinishida: taomlar, variantlar (`label`, `size`, `price`), rasm manzili |
| `/api/v2/tv?media=<id>` | Rasm |
| `/api/v2/monitor` | Boshqaruv sahifasi (faqat rahbar): «⋯» tugmasi → «Monitor menyu» |

Televizor manzillari faqat `GET` qabul qiladi, hech narsa yozmaydi, sahifada parol/kalit yo‘q. Javoblar
keshlanmaydi (`no-store`); faqat rasm doimiy keshlanadi (manzili o‘zgarmas).

## Ko‘rinish: nega eski bilan bir xil

- `app/core/tv-css.ts` — eski saytning CSS’i **so‘zma-so‘z** (16 173 belgi, SHA-256 `dd53192b…`).
- `app/core/tv-page.ts` — eski sayt chizadigan HTML’ning aynan o‘zi va o‘sha tartib:
  har taom navbat bilan katta (8 s) → hammasi o‘tgach umumiy ko‘rinish (15 s). Uchala ekran server soati
  bo‘yicha bir vaqtda almashadi; navbat uzunligi — eng ko‘p taomli ekrandagi taomlar soni.
- `tests/v2-digital-menu.test.mjs` har uch ekran HTML’i, sarlavha, SET MENU tasmasi va CSS eski saytdan
  2026-10-05 da olingan belgilar bilan **harfma-harf** tengligini tekshiradi. Bu fayllarni o‘zgartirsangiz test yiqiladi.

Eski saytda o‘chiq bo‘lgani uchun ko‘rib bo‘lmagan, shuning uchun eski CSS asosida tiklangan qismlar:
«Kun aksiyasi» sahifasining ichki tuzilishi, «SOTILDI» yozuvining tegi, SET MENU o‘chiq bo‘lgandagi pastki qator.

## Sayqallangan variant (ixtiyoriy)

`/menu?screen=kebab&look=premium` — **o‘sha ko‘rinish**, ustidan kichik qatlam (`app/core/tv-css-sayqal.ts`).
Joylashuv, ranglar, kartalar va TYPE/SIZE/PRICE jadvali o‘zgarmaydi. Manzilda `&look=premium` bo‘lmasa asl ko‘rinish chiqadi.

- Yozuvlar kattaroq (televizorlar baland osilgan): umumiy ko‘rinishda nom 24→34, narx 29→40; katta ko‘rinishda
  nom 52→68, jadval yozuvi 20→28, narx 25→40 piksel (1920×1080 da). Katta ko‘rinishda rasm 68%→64%.
- Umumiy ko‘rinishda bitta narx o‘rniga hamma narx (2–4 ta bo‘lsa); rasm 70%→60%.
- Jadvalda harflar bir xil («chicken» / «CHICKEN» → «Chicken»); ma’lumotning o‘zi o‘zgarmaydi.
- «Taom haqida qisqa ma’lumot» namuna yozuvi ko‘rsatilmaydi.
- Taom almashganda yumshoq ochiladi; «SET MENU» yozuvi chetdan ko‘tarilgan; to‘liq ekranda tugma yashirinadi.

## Yangilanish va internetsiz holat

- Sahifa har 15 soniyada so‘raydi. Menyu o‘zgarmagan bo‘lsa ekran qayta chizilmaydi; o‘zgargan bo‘lsa
  sahifani qayta ochmasdan yangilanadi.
- Oxirgi muvaffaqiyatli menyu televizor xotirasida (`localStorage`) turadi: internet yoki baza vaqtincha
  ishlamasa ekranda oxirgi menyu qoladi, aloqa qaytsa o‘zi yangilanadi.
- Cheklov: televizor internet yo‘q paytida o‘chirib-yoqilsa, sahifaning o‘zi ochilmaydi (eski saytda ham shunday).

## Eski saytdan ko‘chirish

- 18 taom eski ID’lari bilan (`item-1786163282248-7aaatn` …) — `app/core/digital-menu-seed.ts`.
  Eski `price/price2/price3/price4` + `itemType/grams…` → `variants[] { id, label (TYPE), size (SIZE), price, active }`.
- Rasmlar: «Monitor menyu» → «Rasmlarni HALO Control’ga ko‘chirish». Server eski saytdan faqat o‘qiydi va
  rasmni **o‘zgarishsiz** (qayta siqmasdan) bazaga saqlaydi. Ko‘chirilmaguncha ekran rasmni eski saytdan oladi.
- Narxlar: «Menyudan mos taomlarni ko‘rish» → rahbar tasdiqlagan qatorlar HALO Control menyusiga bog‘lanadi.
- Eski sayt va uning manzillari o‘zgartirilmaydi; televizorlar yangi manzilga rahbar tekshirib bo‘lgach o‘tkaziladi.
