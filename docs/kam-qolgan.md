# Kam qolgan — xodim tugayotgan mahsulotni Telegram orqali yuboradi

## Xodim

Xodim ilovasi → **🛒 Kam qolgan** (ruxsat shart emas — PIN bilan kirgan har bir xodim).

1. Ombor ro'yxatidan tanlaydi (qidiruv, kategoriya) yoki ro'yxatda yo'q narsani yozadi («Salfetka»).
2. Har biriga ixtiyoriy izoh: «2 quti», «deyarli tugadi».
3. **📨 Rahbarga yuborish** → xabar HALO Telegram botiga ketadi.
4. Oynada «Bugun yuborilgan» ro'yxati turadi — boshqa xodim yozganini qayta yozmaslik uchun.

## Telegram xabari

HALO hisobot boti yuboradi, hisobot boradigan chatga (Yana → Sozlash → Ulanishlar → Telegram bot):

```
🛒 Kam qolgan — HALO Asosiy filial
👤 Aziz · 16.10 12:10

• Mol go'shti — 2 quti
• Lavash
• Salfetka (ro'yxatda yo'q)

Jami: 3 ta · HALO Control → Ombor
```

## Rahbar

Ombor sahifasida (Mahsulotlar) **📨 Xodimlar yozgan kam qolganlar** — oxirgi 7 kun: kim, qachon, nima, Telegramga
ketdimi. Olgach **✓ Olindi** (yozuv o'chmaydi, «Olinganlar»ga o'tadi; «Qaytarish» bilan qayta ochiladi).
Telegramga ketmagan xabar sababi bilan ko'rinadi va **Qayta yuborish** mumkin.

## Qoidalar

- Avval yozuv saqlanadi, keyin yuboriladi — bot ulanmagan yoki Telegram javob bermasa ham xabar yo'qolmaydi.
- Bir amal raqami — bitta yozuv va bitta xabar (tugma ikki marta bosilsa ham).
- Mahsulot nomi serverda ombordan olinadi; ro'yxatdan olib tashlangan mahsulot qabul qilinmaydi. Bir martada ≤ 40 ta.
- Ombor qoldig'i va pulga hech narsa yozilmaydi — bu faqat xabar.
- Bot tokeni hech qachon javobda qaytmaydi. Yozuvlar `v2_low_reports` jadvalida.

Kod: `app/core/low-stock.ts`, `app/api/v2/kam/route.ts`, `app/api/v2/xodim/route.ts` (`lowScreen`),
`app/api/v2/ombor/route.ts` (`kamHtml`). Sinovlar: `tests/v2-kam-qolgan.test.mjs`.
