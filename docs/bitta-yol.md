# Bitta ish — bitta yo'l

Har bir ishni kiritishning faqat bitta joyi bor. Shunda hech narsa ikki marta yozilmaydi va «qayerga kiritay?» degan
savol qolmaydi.

| Ish | Rahbar qayerda kiritadi | Xodim qayerda kiritadi |
| --- | --- | --- |
| Savdo (naqd, hisob-raqam, delivery) | Kundalik → **Kiritish** → Savdo | **HALO HISOB** |
| POS apparati savdosi | Kundalik → Kiritish → POS hisobot (Excel) | — |
| Mahsulot keldi | Xarid → **📦 Yangi kirim** | Xodim ilovasi → Mahsulot kirimi |
| Yetkazib beruvchiga pul berildi | Xarid → yetkazib beruvchi → **💸 To'lov qildim** | — |
| Xarajat (ijara, svet, reklama…) | Kundalik → Kiritish → Xarajat | — |
| Yeyilgan / isrof | Kundalik → Kiritish → Yeyilgan / isrof | HALO HISOB |
| Xodim ishlagan kun | Xodimlar → Maosh → xodim → **🗓 Ishlagan kunlar** | Xodim ilovasi → Keldim / Ketdim |

## Mahsulot kirimi

**📦 Yangi kirim** — bitta saqlash omborga kirimni, qarzni va to'lovni birga yozadi
([yetkazuvchi-kirim.md](yetkazuvchi-kirim.md)). Avval «kimdan keldi» tanlanadi:

- yetkazib beruvchi — qarzga, to'landi yoki bir qismi;
- **🛒 Bozor / naqd** — yetkazib beruvchisiz xarid: omborga kiradi, pul tanlangan hisobdan chiqadi, qarz yozilmaydi.
  Buning uchun «Bozor / naqd xarid» degan doimiy hisob o'zi ochiladi (qarzi har doim 0, hamma bozor xaridi bitta aktda).

Kiritish sahifasidagi «📦 Mahsulot kirimi ›» tugmasi shu oynaning o'ziga olib boradi — bu ikkinchi yo'l emas.

Olib tashlangan yo'llar (rahbar ekranida endi yo'q):

- Kiritish → «Ombor kirimi» va «Sabzavot va sous» — faqat omborga yozardi, pul tomoni unutilardi;
- Yetkazib beruvchi → «+ Xarid (qarz oshadi)» — faqat qarzga yozardi, omborga kirmasdi.

## To'lovi yozilmagan kirimlar

Xodim «Mahsulot kirimi» orqali qabul qilgan (yoki oldin to'lovsiz kiritilgan) mahsulot omborga tushadi, lekin puli hali
yozilmagan bo'ladi. Shunday kirimlar Xarid sahifasida **⏳ To'lovi yozilmagan kirimlar** ro'yxatida chiqadi. Har biri bir
marta yopiladi — «Yozish»:

- **Qarzga** — tanlangan yetkazib beruvchiga qarz shu summaga oshadi;
- **To'landi** — pul tanlangan hisobdan chiqadi (foydaga ikkinchi marta ta'sir qilmaydi), qarz oshmaydi;
- **Yozuv kerak emas** — puli oldin yozilgan bo'lsa: kirim ro'yxatdan olinadi, ombor va qarzga tegilmaydi.

Qoidalar:

- Summa va sana kirimning o'zidan olinadi; mahsulot omborga ikkinchi marta kirmaydi.
- Bitta kirimga bitta yozuv: qayta bosilsa ikkinchisi yaratilmaydi. Yozuv olib tashlansa, kirim ro'yxatga qaytadi.
- Sabzavot / sous olingan kuni bir marta xarajat bo'lgan — pul tomoni yozilganda ikkinchi marta xarajat bo'lmaydi.
- Ro'yxatga oxirgi 60 kunning ochiq oydagi kirimlari chiqadi; «Yangi kirim» hujjatlari va MEZANA bu yerga tushmaydi.
- Kassada yopilgan kunga «To'landi» yozilmaydi («Qarzga» yoziladi).

**🧾 Shu oy kirimlari** (sahifa pastida) — shu oyda omborga kirgan hamma mahsulot; xato kirim shu yerdan olib tashlanadi.

## Xodim ishlagan kunlar

Alohida «＋ Smena» tugmasi yo'q. **🗓 Ishlagan kunlar** taqvimida bitta kun ham, bir nechta kun ham belgilanadi. Smenasi
bor kunga yana bitta smena (masalan, kunduzi va kechqurun) shu yerdan qo'shiladi — vaqti ustma-ust tushsa, saqlanmaydi.

Kod: `app/core/receipts.ts` (ro'yxatlar, Bozor / naqd hisobi), `app/core/receipts-ui.ts` (oynalar),
`app/api/v2/qarz/route.ts` (`market`, `settle`, `dismiss` amallari), `app/core/staff.ts` (`addShifts`).
Sinovlar: `tests/v2-kirim-tartibi.test.mjs`, `tests/v2-maosh-route.test.mjs`.
