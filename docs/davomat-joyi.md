# Keldim / ketdim joyi — xodim faqat oshxona yaqinida bosa oladi

Sozlash: HALO Control → **Maosh** → **📍 Keldim / ketdim joyi** (har filial uchun alohida).

## Qanday ishlaydi

1. Rahbar oshxonada turib «📍 Hozir turgan joyim — oshxona»ni bosadi (yoki koordinatani xaritadan kiritadi),
   masofani yozadi (odatda 100 m) va saqlaydi.
2. Xodim «ISHNI BOSHLADIM» yoki «ISHNI TUGATDIM»ni bosganda telefoni joylashuvni yuboradi.
3. Server masofani hisoblaydi: doira ichida bo'lsa — yoziladi; uzoqda, joylashuvsiz yoki GPS juda noaniq bo'lsa — yozilmaydi
   va xodimga sababi aytiladi (necha metr uzoqdaligi bilan).

## Joyni belgilashning uch yo'li

1. **«📍 Hozir turgan joyim — oshxona»** — oshxonada turib bosiladi, telefon joyni o'zi aniqlaydi.
2. **Manzil yoki joy nomi bo'yicha topish** — manzil koreyscha yoziladi (yoki do'kon nomi), «Topish» bosiladi, topilgan
   joylardan o'zingizniki tanlanadi, xaritada tekshiriladi va saqlanadi. Qidiruv Kakao Local API orqali
   (`app/core/geocode.ts`): avval aniq manzillar, keyin joy nomlari. Qidiruvning o'zi hech narsa saqlamaydi.
3. **Koordinatani qo'lda yozish** — `37.456300, 126.705200` ko'rinishida.

### Kakao kaliti

Manzil qidirish uchun Kakao **REST API 키** kerak (developers.kakao.com → 내 애플리케이션 → ilova → 앱 키). Rahbar uni
sozlash oynasida bir marta kiritadi:

- kalit avval Kakao'da tekshiriladi — qabul qilinmagan kalit saqlanmaydi;
- bazada `v2_geocode` jadvalida turadi (Telegram bot tokenlari kabi) va javoblarda **qaytarilmaydi** — sahifa faqat
  «kiritilgan / kiritilmagan»ni biladi; repo'da kalit yo'q;
- to'liq ko'chirish fayliga (eksport) boshqa jadvallar bilan birga tushadi — bu faylni hech kimga yubormang;
- Kakao ilovasida «카카오맵» xizmati yoqilgan bo'lishi va «허용 IP» cheklovi bo'lmasligi kerak — aks holda sahifa sababini aytadi.

## Qoidalar

- Cheklov **«Keldim»ga ham, «Ketdim»ga ham** tegishli. Xodim ketishni unutib uzoqlashsa, smena ochiq qoladi —
  rahbar Maosh → «Yozuvlar / tuzatish»dan vaqtni to'g'rilaydi.
- GPS aniqligi 100 metrdan (yoki belgilangan doiradan) yomon bo'lsa, joylashuv qabul qilinmaydi — qayta urinish so'raladi.
- Xodim bosa olmagan kunni rahbar «🗓 Ishlagan kunlar» yoki «＋ Smena» orqali o'zi kiritadi.
- Nuqta belgilanmaguncha cheklov yoqilmaydi; o'chirilsa — xodim avvalgidek istalgan joydan bosadi.
- Masofa 30–1000 metr oralig'ida.

## Maxfiylik va chegaralar

- Xodimning koordinatasi **saqlanmaydi**. Jurnalga (`v2_attendance_log`) faqat: kim, qaysi tugma, necha metr uzoqda,
  GPS aniqligi, qabul qilindimi. Oxirgi 300 ta yozuv saqlanadi; rahbar oxirgi 30 tasini sozlash oynasida ko'radi.
- Telefon yuborgan joylashuvga ishoniladi: soxta GPS ilovasidan to'liq himoya emas. Shu sabab har urinish (rad etilgani ham)
  jurnalda ko'rinadi.
- Sozlama (`v2_attendance_place`) va jurnal alohida jadvallarda — eski saytdan ma'lumot ko'chirilganda tegilmaydi.

Kod: `app/core/attendance-place.ts` (qoidalar), `app/core/geocode.ts` (manzil qidirish), `app/core/attendance-place-ui.ts` (rahbar oynasi),
`app/api/attendance/route.ts` (tekshiruv), `app/api/v2/xodim/route.ts` va `app/worker/page.tsx` (xodim telefoni joylashuvni
yuboradi), `app/api/v2/maosh/route.ts` (`place`, `savePlace`, `geocode`, `saveGeoKey`, `removeGeoKey`). Sinovlar: `tests/v2-davomat-joyi.test.mjs`.
