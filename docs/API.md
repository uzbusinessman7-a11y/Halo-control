# HALO Control — API ma'lumotlari

Bu hujjat HALO Control'ning tashqi tizimlar uchun manzillarini (API) tasvirlaydi: nima so'raladi, nima qaytadi va
qanday himoyalangan. **Kalit va tokenlar bu yerda ham, repo'ning boshqa joyida ham saqlanmaydi** — ular faqat
HALO Control bazasida (xesh ko'rinishida) va ulanayotgan tizimning yashirin sozlamalarida turadi.

Sayt manzili: `https://halo-control.uzbusinessman7.workers.dev` (quyida `{SAYT}`).

---

## 1. Telegram do'kon (HALO CLUB) ulanishi

HALO CLUB — Telegram Mini App orqali buyurtma qabul qiladigan alohida sayt (Hatchable'da, kodi `halo-club` repo'sida).
U HALO Control'ga faqat ikki manzil orqali murojaat qiladi. Boshqarish: HALO Control → ⋯ → **Telegram do'kon**
(`/api/v2/club`).

### Kalit

- `Authorization: Bearer halo_club_…` sarlavhasi bilan.
- Kalit «Telegram do'kon» sahifasida yaratiladi va **bir marta** ko'rsatiladi; bazada faqat SHA-256 xeshi turadi
  (`v2_club_settings.key_hash`). Yangi kalit yaratilsa, eskisi shu zahoti ishlamay qoladi.
- Bu kalit faqat quyidagi ikki manzilda ishlaydi; umumiy API kaliti (`halo_live_…`) bu manzillarda ishlamaydi va aksincha.
- Kalit filialga bog'langan: qaysi filial sahifasida yaratilgan bo'lsa, yozuvlar o'sha filialga tushadi.

### 1.1. `POST {SAYT}/api/integrations/v1/club/sync` — menyu sinxroni

Do'kon o'z mahsulotlari ro'yxatini yuboradi va har biri uchun ko'rsatma oladi. Savdo, ombor yoki kassaga hech narsa yozilmaydi.

So'rov:

```json
{
  "products": [{ "id": "haggi-chicken", "name": "Haggi Chicken", "category": "Haggi", "price": 10900, "active": true }],
  "addons":   [{ "id": "9b1f…", "name": "Pishloq", "price": 1000, "active": true }]
}
```

Javob:

```json
{
  "ok": true, "updatedAt": "…", "priceSync": true, "stockSync": true,
  "products": [{ "id": "haggi-chicken", "linked": true, "price": 9000, "soldOut": false }],
  "addons":   [{ "id": "9b1f…", "linked": false, "price": null }]
}
```

- `linked` — mahsulot HALO Control'dagi taomga (retseptga) bog'langanmi. Bog'lash **faqat rahbar tomonidan**, «Telegram do'kon»
  sahifasida qilinadi; do'kon yuborgan ma'lumot bog'lanishni o'zgartira olmaydi.
- `price` — «Narx HALO Control'dan» yoqilgan va mahsulot bog'langan bo'lsa, taomning sotuv narxi; aks holda `null` (do'kon o'z narxini qoldiradi).
- `soldOut` — «Tugagan mahsulot yopilsin» yoqilgan, mahsulot bog'langan va ombordagi mahsulot bir portsiyaga yetmasa `true`.
  Omborsiz yuritiladigan mahsulotlar (sabzavot, sous) hisobga kirmaydi; omborga bog'lanmagan taom hech qachon «tugagan» bo'lmaydi.

Xatolar: `401` kalit noto'g'ri · `413` so'rov juda katta · `422` ro'yxat noto'g'ri.

### 1.2. `POST {SAYT}/api/integrations/v1/club/orders` — buyurtma hodisasi

Do'kon buyurtmaning hozirgi holatini yuboradi (`new`, `accepted`, `preparing`, `ready`, `completed`, `cancelled`).

```json
{
  "order": {
    "id": "0d5b6c1e-…", "number": "1002", "status": "completed",
    "fulfillment": "DELIVERY", "paymentMethod": "BANK_TRANSFER", "paymentStatus": "PAID",
    "subtotal": 21800, "promotionDiscount": 0, "cashbackUsed": 0, "deliveryFee": 6000, "total": 27800,
    "promotionName": "", "arrivalMinutes": 0, "createdAt": "…", "completedAt": "…",
    "items": [{ "productId": "haggi-chicken", "name": "Haggi Chicken", "quantity": 2, "unitPrice": 10900, "lineTotal": 21800,
                "addons": [{ "id": "9b1f…", "name": "Pishloq", "price": 1000 }] }]
  }
}
```

**Mijozning ismi, telefoni, manzili va izohi yuborilmaydi** (yuborilsa ham saqlanmaydi).

Tekshiruv (mos kelmasa `422`, hech narsa yozilmaydi): `lineTotal = unitPrice × quantity`; `subtotal = Σ lineTotal`;
`total = subtotal − promotionDiscount + deliveryFee − cashbackUsed`.

Javob:

```json
{ "ok": true, "order": { "id": "…", "number": "1002", "status": "completed" },
  "sale": { "state": "saved", "note": "Hisob-raqam · ₩21,800 · kuryer puli ₩6,000", "date": "2026-10-05", "alreadySaved": false },
  "notified": false, "noticeReason": "" }
```

Nima bo'ladi:

| Hodisa | HALO Control'da |
|---|---|
| `new` | Buyurtmalar guruhiga xabar (ulangan bo'lsa), bir buyurtma — bir marta |
| `cancelled` | Guruhga «bekor qilindi» xabari (yangi buyurtma xabari borgan bo'lsa) |
| `completed` | Savdoga yozish (pastdagi qoidalar) |
| boshqalar | Faqat holat yangilanadi |

Holat orqaga qaytmaydi; topshirilgan yoki bekor qilingan buyurtma o'zgarmaydi. Bir buyurtma istalgancha qayta
yuborilishi mumkin — savdo **bir marta** yoziladi (`alreadySaved: true`).

`sale.state` qiymatlari:

| Qiymat | Ma'nosi |
|---|---|
| `saved` | Savdoga yozildi |
| `skipped` | Yozilmaydi: karta to'lovi (OKPOS apparatidan o'tadi va POS hisobotidan keladi) |
| `waiting` | Hozircha yozib bo'lmadi — sababi `note` da: yozish o'chirilgan, mahsulot bog'lanmagan, retsept omborga bog'lanmagan, kun yoki oy yopilgan. Rahbar sababni bartaraf etib «Yozish»ni bosadi |
| `cancelled` | Rahbar bu savdoni bekor qilgan — do'kon qayta yuborsa ham qayta yozilmaydi |

Xatolar: `401` kalit · `422` hisob noto'g'ri (qayta yuborish foydasiz) · `503` vaqtinchalik (do'kon keyinroq qayta yuboradi).

### 1.3. Savdoga yozish qoidalari

- **Qachon:** faqat buyurtma topshirilganda (`completed`). Sana — topshirilgan kun (Seul vaqti).
- **Qaysi hisob:** naqd → naqd kassa; bank o'tkazmasi → hisob-raqam. Ikkalasi «HALO hisob» kanali — qo'lda kiritilgandagidek
  soliqsiz. To'liq cashback bilan to'langan buyurtma — tushum 0, ombor kamayadi.
- **Karta:** yozilmaydi (ikki marta sanalmasligi uchun).
- **Tushum:** mijoz ovqat uchun haqiqatda to'lagan pul = `subtotal − promotionDiscount − cashbackUsed`. Chegirma taomlarga
  narxiga mutanosib va 1 wongacha aniq taqsimlanadi (yig'indi doim to'g'ri chiqadi).
- **Yetkazish haqi:** daromad emas. «Kuryer puli (yetkazish haqi)» turi bilan alohida kirim yoziladi, foydaga ta'sir qilmaydi;
  pul jurnalida `kuryer-puli` hisobida turadi. Kuryerga berilganda Kiritish → Xarajat → shu tur tanlanadi — hisob nolga tushadi.
- **Ombor:** har taom retsepti bo'yicha kamayadi (HALO HISOB oynasidagi savdo bilan bir xil yo'l). Bog'langan qo'shimcha —
  alohida taom sifatida; bog'lanmagan qo'shimchaning narxi asosiy taomda qoladi, ombor kamaymaydi.
- **Ko'rinishi:** HALO HISOB → «Bugun» ro'yxatida «Telegram do'kon» nomi bilan — xodim qayta kiritmasligi uchun.
- **Bekor qilish:** «Telegram do'kon» sahifasidan yoki HALO HISOB oynasidan; ombor qaytadi, kuryer puli kirimi olib tashlanadi.

### 1.4. Jadvallar

`v2_club_settings` (kalit xeshi, kalit-tugmalar, guruh), `v2_club_products` (do'kon mahsulotlari va bog'lanish),
`v2_club_orders` (kelgan buyurtmalar, savdo holati, guruh xabari belgisi). Eski saytdan ma'lumot ko'chirilganda bu
jadvallarga tegilmaydi.

Kod: `app/core/club.ts` (qoidalar, sof funksiyalar), `app/core/club-service.ts` (yozish va xabar),
`app/api/integrations/v1/club/*` (manzillar), `app/api/v2/club/route.ts` (sahifa). Sinovlar: `tests/v2-club.test.mjs`.

---

## 2. Umumiy integratsiya API (faqat o'qish)

Kalit: `Authorization: Bearer halo_live_…` (yoki `X-Halo-Api-Key`). Kalit Ulanishlar sahifasida yaratiladi, har biriga
ruxsatlar ro'yxati beriladi va istalgan payt bekor qilinadi. Filialda integratsiya o'chirilgan bo'lsa, kalit ishlamaydi.

| Manzil | Ruxsat | Parametrlar | Qaytaradi |
|---|---|---|---|
| `GET /api/integrations/v1/sales` | `sales:read` | `from`, `to` (YYYY-MM-DD), `limit` (≤500), `offset` | Savdolar ro'yxati |
| `GET /api/integrations/v1/inventory` | `inventory:read` | — | Ombor mahsulotlari va qoldiq |
| `GET /api/integrations/v1/reports` | `reports:read` | `date` yoki `month` | Kunlik / oylik hisobot |
| `GET /api/integrations/v1/export` | `export:read` | — | To'liq eksport (zaxira uchun) |
| `GET /api/integrations/v1/google-sheets` | `reports:read` | `from`, `to`, `if_updated_at`, `if_export_version` | Google Sheets uchun jadvallar; o'zgarmagan bo'lsa `unchanged` |

Har so'rov `integration_logs` jadvaliga yoziladi (Ulanishlar sahifasida ko'rinadi).

---

## 3. Xavfsizlik qoidalari

- Kalit, token va parollar GitHub'ga qo'yilmaydi. Cloudflare'da — yashirin sozlamalar; bazada — faqat xesh.
- Televizor (monitor menyu) hech qanday kalitsiz, faqat o'qiladigan manzildan foydalanadi.
- Yozish/o'zgartirish/o'chirish faqat rahbar kirgan HALO Control sahifalari orqali; Telegram do'kon kaliti bundan mustasno
  va faqat 1-bo'limdagi ikki manzilga ruxsat beradi.
- Telegram bot tokenlari (hisobot boti, yordamchi bot) faqat sayt bazasida; javoblarda qaytarilmaydi.
