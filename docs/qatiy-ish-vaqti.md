# Qat'iy ish vaqti — erta kelsa ham hisob belgilangan vaqtdan

Sozlash: HALO Control → **Yana** → 👥 Xodimlar sozlamasi → **Qat'iy ish vaqti** (yoki Maosh sahifasi pastidagi
«⏰ Qat'iy ish vaqti ›»). Har filial uchun alohida, har xodimga alohida vaqt.

## Qanday ishlaydi

1. Rahbar xodimga **ish boshlanish** vaqtini yozadi (masalan, 11:00). Xohlasa **tugash** vaqtini ham (masalan, 23:00).
   «Hammaga bir xil vaqt» — ro'yxatni bir bosishda to'ldiradi; keyin «Saqlash».
2. Xodim 10:00 yoki 10:30 da kelib «ISHNI BOSHLADIM»ni bossa — tugma ishlaydi, kelgan asl vaqti yoziladi,
   lekin **haq 11:00 dan hisoblanadi**.
3. Xodim telefonida buni ko'rib turadi: bosishdan oldin «Ish vaqti 11:00 dan…», bosgandan keyin
   «Hisob 11:00 dan boshlanadi» va taymer 0:00 da turadi.

## Qoidalar

| Holat | Hisob |
|---|---|
| Erta keldi | belgilangan boshlanish vaqtidan |
| Vaqtida yoki kech keldi | bosgan vaqtidan |
| Tugash vaqti yozilgan, undan keyin qoldi | tugash vaqtigacha |
| Tugash vaqti yozilmagan | ketgan vaqtigacha |
| Ish vaqtidan butunlay tashqarida bosdi (tugash vaqti bor) | 0 — rahbar tuzatishi kerak |

- Kelgan va ketgan **asl vaqt o'chmaydi**. Maosh → xodim → «Yozuvlar / tuzatish»da smena yonida
  «⏰ hisob 11:00 dan» deb ko'rinadi.
- Yangi vaqt **keyingi «ISHNI BOSHLADIM»dan** ishlaydi. Oldingi kunlar va hozir ochiq turgan smena o'zgarmaydi.
- Rahbar qo'lda kiritgan kunlar («🗓 Ishlagan kunlar») to'liq hisoblanadi — rahbar o'zi yozgan vaqt.
- **Bir kunlik istisno** (xodimni rahbar o'zi erta chaqirgan): «Yozuvlar / tuzatish» → smena ✏️ →
  «Bu smenada qat'iy vaqt qo'llanmasin» + sabab. Olib tashlangan qoida tuzatish tarixida qoladi.
- Akkaunti yo'q xodim tugmani bosa olmaydi — unga qoida amalda ta'sir qilmaydi (ro'yxatda «akkaunt yo'q» belgisi).
- Har o'zgarish «O'zgarishlar tarixi»ga «Qat'iy ish vaqti saqlandi» deb yoziladi.

## Ichki tuzilishi

- Yangi jadval yo'q. Vaqt xodim yozuvidagi mavjud `scheduledStartTime` / `scheduledEndTime` maydonlarida saqlanadi —
  eski tizimning maosh hisobi shularni biladi, ikkinchi hisob paydo bo'lmaydi.
- Tugma bosilgan paytda hisob oynasi smenaning o'ziga yoziladi (`payWindowStartAtShift` / `payWindowEndAtShift`).
  Hisob faqat shu ikki maydonga qaraydi (`workShiftMinutes`), shuning uchun keyingi o'zgarish orqaga ta'sir qilmaydi.
- **Tugash vaqti yozilmagan** bo'lsa, u «boshlanish + 18 soat» sifatida saqlanadi (11:00 → 05:00): smena 18 soatdan
  uzun bo'lmaydi, demak oxiridan hech narsa kesilmaydi. Rahbarga bu maydon bo'sh ko'rinadi. Bunday xodim vaqtida yoki
  kech kelsa, smenaga oyna umuman yozilmaydi (`clockInPayWindow`).
- Yarim tundan keyingi bosish: eski tizim qoidasi bo'yicha, bosilgan payt kechagi ish oynasi ichida bo'lsa, u kechagi
  smenaga tegishli deb olinadi (tungi smena uchun). 11:00 da boshlanadigan xodim uchun bu 00:00–05:00 oralig'i.
- `freezeWorkShiftRates` (eski ekranda xodim tahrirlanganda stavkani muzlatadi) endi hisob oynasini qo'shmaydi —
  aks holda ish vaqti keyin qo'yilgan xodimning oldingi kunlari orqaga qarab kesilib qolardi.

Kod: `app/core/work-hours.ts` (qoidalar), `app/core/work-hours-ui.ts` (rahbar oynasi), `app/api/attendance/route.ts`
(tugma bosilganda oyna; xodimga `hours` va `pay` qaytadi), `app/api/v2/maosh/route.ts` (`hours`, `saveHours`, `?b=vaqt`),
`app/core/staff.ts` (`editShift` — `free`, yozuvlarda `pay`), `app/api/v2/xodim/route.ts` (xodim ekranidagi yozuv va taymer).
Sinovlar: `tests/v2-qatiy-ish-vaqti.test.mjs`.
