# Stavka sanadan — oy o'rtasida oylik oshsa, faqat o'sha kundan hisoblanadi

Joyi: **Maosh** → pastda **👥 Xodimlar ro'yxati va stavkalar** → xodimni bosing.

1. Soatlik stavkani, oylikni yoki ish rejasini (oyda ish kuni, kunlik soat, ortiqcha soat qoidasi) o'zgartiring.
2. **«Yangi shart qachondan boshlab hisoblansin?»** chiqadi — standart: bugun. Kerakli sanani tanlang (o'tgan yoki kelajak).
3. «Saqlash» → «✓ Saqlandi. Yangi shart 15.10 dan hisoblanadi — N ta kun yangi stavkada qayta hisoblandi».

## Qoidalar

- Tanlangan sanadan (va keyingi) ish kunlari va pullik dam kunlari yangi stavkada qayta hisoblanadi; undan oldingi kunlar
  eski stavkada qoladi. Faqat ism yoki «Ishlayapti» o'zgarsa — hech narsa qayta hisoblanmaydi.
- Oylik maoshda soatlik ulush = oylik ÷ (oyda ish kuni × kunlik soat). 2 600 000 → 3 120 000 (26 × 8) bo'lsa: 12 500 → 15 000 ₩/soat.
- O'zgarish tarixi xodimda saqlanadi («Stavka tarixi»). Keyin kiritilgan oldingi sanali kun (unutilgan ish kuni, pullik dam)
  o'z sanasidagi stavkani oladi. Kelajakdagi sana tanlansa — o'sha kungacha «ISHNI BOSHLADIM» eski stavkada yoziladi.
- Stavkasi yozilmagan eski (eski tizimdan kelgan) ish kunlari avvalgi stavkada «muzlatiladi» — orqaga qarab o'zgarmaydi.
- Yopilgan oydagi sanadan boshlab bo'lmaydi. Oxirgi o'zgarish sanasidan oldingi sana tanlanmaydi.
- Qayta hisoblangan kunlar maosh daftarida tuzatish sifatida ko'rinadi (eski yozuv teskari yozuv bilan yopiladi — tarix qoladi).

Kod: `app/core/staff-rates.ts` (`applyRateChange`, `memberOn`), `app/core/staff.ts` (`saveStaffMember`, `addShift`,
`setDayStatus`), `app/api/attendance/route.ts` (ISHNI BOSHLADIM), `app/api/v2/maosh/route.ts` (forma).
Sinovlar: `tests/v2-stavka-sanadan.test.mjs`.
