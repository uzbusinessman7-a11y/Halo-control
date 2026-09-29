# HALO V2 — 1-bosqich: Pul jurnali va ko'r kassa sanog'i

Holat: **yadro tayyor va sinovdan o'tgan** (`tests/v2-ledger.test.mjs`, 11 sinov).
Jonli saytga hali ulanmagan — keyingi qadamlar pastda.

## Nima uchun

Eski tizimda kassa qoldig'i bir necha joyda turlicha hisoblanardi (1₩ farq shundan
chiqqan) va qoldiqlar to'g'ridan-to'g'ri o'zgartirilardi. V2 da:

| Qoida | Qanday ta'minlanadi |
|---|---|
| Har bir won "qayerdan → qayerga" | Har bir yozuvda ≥2 qator, yig'indi doim 0 (`validateEntry`) |
| Faqat butun won | Kodda + bazada `CHECK (amount = CAST(amount AS INTEGER))` |
| Yozuv o'zgarmaydi, o'chmaydi | Bazada `UPDATE`/`DELETE` triggerlar bilan taqiqlangan |
| Xato — teskari yozuv bilan | `reverseEntry`: sabab majburiy, bir yozuv faqat bir marta bekor qilinadi |
| Qoldiq qo'lda to'g'rilanmaydi | Qoldiq saqlanmaydi — har doim qatorlardan hisoblanadi |
| Qayta yuborish ikki marta yozmaydi | `operation_id` noyob; bir xil so'rov oldingi natijani qaytaradi |
| Yopilgan kun o'zgarmaydi | Yopilgan sanaga yozuv kiritilmaydi |
| Ko'p biznes | Har bir jadvalda `tenant_id`; hisob faqat o'z biznesi ichida ishlatiladi |

## Ko'r kassa sanog'i

1. **Xodim** kun oxirida har bir kassani sanaydi → `submitBlindCount`.
   Javobda faqat "qabul qilindi" — kutilgan summa **ko'rsatilmaydi**.
2. **Rahbar** `reviewDay`: kutilgan, sanalgan, farq (hisob bo'yicha).
3. **Rahbar** `closeDay`: farq bo'lsa sababi majburiy. Farq "Kassa farqi" hisobiga
   yoziladi (kamomad — xarajat), jurnaldagi kassa haqiqiy pulga tenglashadi, kun qulflanadi.
   Ikki hisob o'rtasidagi adashish (karta savdosi naqd deb kiritilgan) xarajat bo'lmaydi —
   hisoblar o'rtasida to'g'rilanadi.

## Hisoblar rejasi (standart)

`kassa` (naqd, sanaladi) · `bank` (karta, sanaladi) · `savdo` (tushum) ·
`xarajat` · `kassa-farqi` · `ochilish` (ochilish qoldig'i / egasi kapitali).

## Fayllar

- `app/core/ledger.ts` — sof qoidalar (bazaga bog'liq emas).
- `app/core/ledger-store.ts` — D1 jadvallari, triggerlar, saqlash va o'qish.
- `tests/v2-ledger.test.mjs` — haqiqiy SQLite ustida sinovlar.

## Keyingi qadamlar (1-bosqich davomi)

1. **Ko'prik:** eski tizimdagi savdo va xarajatlar V2 jurnaliga avtomatik
   (takrorlanmasdan) yoziladi — parallel ishlash uchun.
2. **Solishtirish:** har kuni eski kassa qoldig'i va V2 qoldig'i avtomatik
   solishtiriladi; farq bo'lsa — rahbar paneli va Telegram.
3. **Ekranlar:** xodim uchun "Kassani sanash" (katta raqam maydonlari, 1 tugma),
   rahbar uchun "Kunni yopish" (kutilgan / sanalgan / farq).
4. **01.10 ochilish qoldiqlari:** 30.09 sanog'idan `opening` yozuvi.

## 4-bosqich: maosh daftari (`/api/v2/maosh`)

- `app/core/payroll-ledger.ts` — `v2_employees`, `v2_pay_moves` (faqat qo'shiladi;
  o'zgartirish/o'chirish bazada taqiqlangan). Ishora: + hisoblandi, − berildi/ushlandi.
  Oy qoldig'i = shu oy yozuvlari yig'indisi. Hisob varaqasi va xodimga yuboriladigan matn.
- `app/core/payroll-bridge.ts` — eski smena, dam kunlari, bonus/ushlanma/avans va
  to'lovlardan yozuvlar. Har bir yozuvning manbasi bor (`d:` ish kuni, `l:` dam, `j:`
  tuzatish, `p:` to'lov, `r:` oy yaxlitlashi). Eski tizimda o'zgarsa — eski versiya teskari
  yozuv bilan yopiladi, yangisi qo'shiladi. Har xodim/oy `calculatePayroll()` bilan
  wonma-won solishtiriladi.
- Nazorat: o'tgan oylardan to'lanmagan maosh, ortiqcha to'lov, kassadan chiqmagan avanslar.
- Sinovlar: `tests/v2-payroll.test.mjs`, `tests/v2-maosh-route.test.mjs`.

## 5-bosqich: bosh sahifa va kunlik hisobot (`/api/v2/bosh`)

- `app/core/home.ts` — bitta so'rovda kassa, ombor, qarz va maosh ko'priklari yangilanadi
  va asosiy ko'rsatkichlar yig'iladi: savdo (bugun, kecha, oy boshidan, o'tgan davr bilan),
  prime cost (retsept sarfi + chiqit + sanoq kamomadi + ish haqi) %, pul holati, qarz,
  maosh va ogohlantirishlar (qizil birinchi). `flashText()` — Telegram uchun qisqa matn.
- Sahifada "Telegramga yuborish" (yangi saytda bot ulangan bo'lsa) va "Nusxa".
- Unumdorlik: mahsulot, yetkazuvchi va xodimlarni yaratish endi bitta paketda
  (Cloudflare D1 so'rov limitiga tushmaslik uchun); qarz yoshi bitta so'rov bilan.

## Oy yakuni sanog'i (`/api/v2/sanoq`)

- `app/core/period-count.ts` — `v2_period_counts` (faqat qo'shiladi). Pul hisoblari, ombor
  mahsulotlari (sabzavot kabi "faqat xarajat" mahsulotlardan tashqari) va yetkazib beruvchi
  qarzlari tanlangan sana oxiriga tizim qoldig'i bilan "ko'r" sanaladi va solishtiriladi.
  Qayta sanalsa, oxirgisi amal qiladi. To'liq o'tishda bu tasdiqlangan boshlang'ich qoldiq bo'ladi.
