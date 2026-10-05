# Yetkazib beruvchidan kirim — bitta saqlashda ombor, qarz va to'lov

Sahifa: HALO Control → **Qarz** → yetkazib beruvchini bosing → **📦 Yangi kirim** va **🗂 Mahsulotlari**.

## Nima uchun

Oldin bitta yuk ikki joyga kiritilar edi: «Ombor kirimi» (mahsulot va tannarx) va «Qarz → Xarid» (qarz). Biri unutilsa yoki
summa har xil yozilsa, ombor qiymati bilan qarz mos kelmay qolardi. Endi bitta saqlash ikkalasini va (to'langan bo'lsa)
to'lovni birga yozadi.

## Mahsulotlar ro'yxati (profil)

Har bir yetkazib beruvchida o'z ro'yxati: nomi, xarid birligi (kg, litr, dona, quti…) va oxirgi narxi.

- Ombor mahsuloti — ombor ro'yxatidan tanlanadi; birlik shu mahsulotga mos bo'lishi shart (dona bilan yuritiladigan
  mahsulot kg bilan olinmaydi).
- Omborsiz xarajat (salfetka, paket) — nomi qo'lda yoziladi. Omborda bor nom omborsiz qilib saqlanmaydi.
- Narx har kirimda o'zi yangilanadi (jami ÷ miqdor). Oldindan yozib qo'yish ham mumkin.
- Ro'yxat `v2_supplier_products` jadvalida — eski saytdan ma'lumot ko'chirilganda tegilmaydi.

## Yangi kirim

1. Ro'yxatdan mahsulot bosiladi, miqdor yoziladi — jami narx o'zi chiqadi (o'zgartirish mumkin).
2. Ro'yxatda yo'q bo'lsa — «+ Ro'yxatda yo'q mahsulot»: ombordan tanlash, yoki nomini yozib ikkidan birini tanlash:
   **omborga qo'shilsin** (yangi ombor mahsuloti shu zahoti yaratiladi; kg → g, litr → ml hisobida) yoki
   **omborsiz xarajat**. «Ro'yxatga saqlansin» belgilansa, keyingi safar bir bosishda chiqadi.
3. To'lov: **Qarzga**, **To'landi** (qaysi hisobdan) yoki **Bir qismi**.
4. Saqlash.

## Hisobda nima bo'ladi (ikki marta xarajat bo'lmaydi)

| Qator | Ombor | Xarajat (foyda) | Qarz |
|---|---|---|---|
| Ombor mahsuloti (go'sht, lavash) | qoldiq va tannarx oshadi | yo'q — sotilganda retsept bo'yicha | jami summaga |
| Sabzavot / sous (omborsiz deb belgilangan ombor mahsuloti) | sanalmaydi | olingan kuni, bir marta | jami summaga |
| Omborsiz xarajat (salfetka) | — | olingan kuni, bir marta | jami summaga |
| To'lov | — | yo'q (`affectsProfit=false`) | kamayadi; pul tanlangan hisobdan chiqadi |

Qarz = jami − to'langan. Hujjat eski tizimning «Xarid / kirim» hujjati (`intake:<amal raqami>`) sifatida yoziladi, shuning
uchun solishtirish akti, «Yozuvlar / bekor qilish», Kiritish → «Shu oy ombor kirimlari» va hisobotlar uni taniydi.
Olib tashlansa — ombor, qarz, xarajat va pul birga qaytadi.

## Himoyalar

- **Tugma ikki marta bosilsa** — ikkinchisi yozilmaydi (amal raqami bo'yicha).
- **Shu kuni shu yetkazib beruvchidan aynan shu yuk** — sabab so'raladi.
- **Shu yuk 3 kun ichida «Ombor kirimi» orqali kiritilgan bo'lsa** — sabab so'raladi (va aksincha: bu yerda kiritilgan
  yukni «Ombor kirimi»ga qayta yozishda ham). Har kuni bir xil yuk keladigan yetkazib beruvchi har safar so'ralmaydi.
- **Narx oxirgisidan 30% dan ko'p farq qilsa** — tasdiq so'raladi (xato terishdan himoya).
- **Omborda bor mahsulot «omborsiz xarajat» qilib yozilmaydi.**
- **Kassada yopilgan kun** — pul chiqadigan kirim yozilmaydi (qarzga kirim yoziladi). Yopilgan oyga hech narsa yozilmaydi.
- To'lov faqat naqd kassa yoki bank hisobidan; jamidan oshmaydi.
- MEZANA — bu yerda emas, alohida «MEZANA hisobi» bo'limida.

«Ombor kirimi» va «+ Xarid» o'z joyida qoladi: birinchisi — yetkazib beruvchisiz olingan mahsulot uchun, ikkinchisi —
mahsulotsiz qarz uchun.

Kod: `app/core/supplier-intake.ts` (qoidalar), `app/core/supplier-intake-ui.ts` (oyna), `app/api/v2/qarz/route.ts`
(`profile`, `saveProduct`, `removeProduct`, `intake` amallari). Sinovlar: `tests/v2-yetkazuvchi-kirim.test.mjs`.
