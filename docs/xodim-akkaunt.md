# Xodim akkaunti — ochish, kirish, o'chirish

Joyi: **Yana → Xodimlar sozlamasi → Akkauntlar** (har filial alohida — tepadagi filialni tanlang).

## Ochish (bir oynada)

1. **Xodim ismi** — yozilganda login ismdan o'zi yoziladi (O'tkir → `otkir`, Жасур → `jasur`); o'zgartirsa bo'ladi.
2. **Qaysi xodim?** — Maosh'dagi, hali akkaunti yo'q xodimlar ro'yxati; ism mos kelsa o'zi tanlanadi.
   Yo'q bo'lsa — **＋ Yangi xodim**: Soatbay / Oylik va stavka; xodim Maosh'ga ham qo'shiladi.
3. **PIN** — 4–8 raqam.

Avval hammasi tekshiriladi, keyin akkaunt ochiladi va xodimga bog'lanadi — «Rahbar akkauntingizni xodim profiliga
bog'lamagan» holati endi bo'lmaydi. Xodimga bog'lab bo'lmasa, akkaunt qaytarib o'chiriladi (yarim ish qolmaydi).
Login noto'g'ri yozilsa (o', g', ’, bo'sh joy, kirill harf) — maydon ostida darrov qizil yozuv chiqadi.

## Kirish

Xodim ilovasida filial noto'g'ri tanlansa ham: bu login faqat bitta filialda bo'lsa — o'sha filialga kiradi
(PIN baribir tekshiriladi). Login ikki filialda ham bo'lsa — tanlangan filial qoladi.

## O'chirish

- **Akkaunt** — «🗑 O'chirish»: login bo'shaydi, xodimning ish kunlari va boshqa yozuvlari o'chmaydi. Akkaunt bilan birga
  ochilgan va hali yozuvi yo'q xodim profili ham olib tashlanadi; oldindan bor xodim profili qoladi (faqat bog'lanish uziladi).
  Vazifa berilgan akkaunt o'chirilmaydi — «To'xtatish» kerak.
- **Xodim (Maosh)** — xodimni ochib «🗑 O'chirish»: faqat hech qanday yozuvi (ish kuni, dam/kasal kuni, bonus/ushlanma,
  to'lov) bo'lmasa. Ishlagan xodim — «Ishlayapti» belgisini olib tashlab, ishdan ketgan qilinadi.

Kod: `app/api/v2/sozlamalar/route.ts` (`createAccount`, `deleteAccount`, forma), `app/lib/worker-auth.ts`
(`loginWorker` — filialni topish, `deleteWorkerAccount`), `app/core/staff.ts` (`deleteStaffMember`),
`app/api/v2/maosh/route.ts` (`deleteStaff`). Sinovlar: `tests/v2-xodim-akkaunt.test.mjs`.
