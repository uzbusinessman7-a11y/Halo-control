# Savdo kunlari — har kun savdosi bitta oynada

Joyi: pastdagi **Bosh** → tepada **Savdo kunlari** (yoki Bosh sahifadagi «Savdo · so'nggi 14 kun» ostidagi tugma).
Eski tizimdagi «Barcha savdo va xodim bonusi» oynasining o'rnida.

## Nima ko'rinadi

1. **Davr:** Bu oy (standart) · O'tgan oy · 30 kun · Sana… (o'zingiz tanlaysiz, ko'pi bilan 93 kun).
2. **Jami:** davrdagi umumiy savdo; POS apparati (karta / naqd), HALO hisob, Delivery, xodim bonusi.
3. **⚠ POS kiritilmagan kunlar** — bugundan oldingi, POS savdosi yo'q har kun tugmacha bo'lib turadi. Bosilsa,
   «Kiritish → POS hisobot» o'sha sana bilan ochiladi. Umuman savdo yozilmagan kun «bo'sh» deb belgilanadi
   (dam olish kuni bo'lsa — e'tibor bermang).
4. **Kunma-kun** — davrdagi HAR BIR kun, savdosi yo'q kun ham: POS holati («POS ✓», «POS ✓ Excel», «POS yo'q»,
   bugun — «bugun»), kanallar bo'yicha summa, jami va bonus. Qatorni bosganda «Kiritish → Savdo» shu sana bilan ochiladi.

## Qoidalar

- Kanallar «POS» oynasidagi kunlik hisobot bilan bir xil ajratiladi (`channelOf` + `saleDeductions`): POS apparati —
  karta va POS naqd (Excel yoki qo'lda); HALO hisob — naqd va hisob-raqam (soliqsiz); Delivery.
- «Excel» — o'sha kunga POS hisobot fayli yuklangan (`sale.posImport`).
- Xodim bonusi — eski tizim qoidasi (`dailySalesBonus`): kunlik savdoning 800 000 ₩ dan oshgan qismining 10%i.
  Maoshga o'zi yozilmaydi.
- Bugun «POS yo'q» hisoblanmaydi — kun tugamagan. Kelajak sanalar ko'rsatilmaydi.
- Bekor qilingan (`cancelledAt`, `voided`, `status: cancelled`) savdo hisobga kirmaydi.
- Sahifa hech narsa yozmaydi.

Kod: `app/core/sales-days.ts` (hisob), `app/api/v2/savdo/route.ts` (sahifa), `app/api/v2/kiritish/route.ts`
(`?sana=YYYY-MM-DD&t=pos` — kun va bo'lim bilan ochish). Sinovlar: `tests/v2-savdo-kunlari.test.mjs`.
