# HALO Control — hisob va kirim tuzatishlari

2026-09-27

## Siz uchun nima o‘zgardi?

- **Pul va xarajat ajratildi.** Pul chiqmagan sous/sabzavot xaridi xarajat hisobida qoladi, kassadan ayrilmaydi. Hisoblar kartalari va Telegram bir xil pul hisobidan foydalanadi.
- **Sous “0” ko‘rinmaydi.** Xarid miqdori, birligi va jami summasi yetkazib beruvchi, ombor tarixi va eksportda xaridning asl maydonlaridan olinadi. Masalan, jismoniy ombor harakati 0 bo‘lsa ham, xarid 30 kg / 198 000₩ ko‘rinadi.
- **Takroriy qarz himoyasi.** Bir yetkazuvchidan bir xil summali xarid 3 kun ichida takrorlansa, alohida xarid ekanini sabab bilan tasdiqlash talab qilinadi. Qayta kelgan aynan bir so‘rov ikkinchi qarz yaratmaydi.
- **Tahrir manbadan ochiladi.** Omborga bog‘langan qarz uchun “Kirimni boshqarish” ochiladi. Alohida qarz/to‘lov uchun tahrir va bekor qilish mavjud. Bekor qilingan yozuvning nusxasi va sababi tarixda saqlanadi.
- **To‘liq bo‘lmagan hisob yashirilmaydi.** Kassa/bank hisobi topilmagan yozuv bo‘lsa, ogohlantirish chiqadi va kunni yopish to‘xtatiladi. Narxi yo‘q sous retsept tannarxida to‘liq deb ko‘rsatilmaydi.
- **Savdo kanali aniqroq.** Naqd savdo POS oynasidan kiritilgan bo‘lsa ham “Naqd” deb ko‘rinadi. Delivery tannarxi umumiy hisobotdagi butun von qoidasi bilan yaxlitlanadi.
- **Maoshdagi “Qo‘shimcha pul”** “Qo‘shimcha ish soati puli” deb nomlandi. Bu savdo bonusi emas; maosh summalari o‘zgartirilmadi.
- **Telegram jadvali tuzatildi.** Google Sheets daqiqalik jadvali ham kunlik hisobotni ishga tushiradi. Bir vaqtda kelgan so‘rovlar bir kun uchun bitta avtomatik xabar yuboradi. Kechikkan 23:59 tekshiruvi yarim tundan keyin ham o‘tgan kunni ushlaydi. Yetkazuvchilarga buyurtma rahbarning alohida tugmasi bilan yuboriladi.

## Qanday ishlatasiz?

1. Mahsulotning miqdori/narxini tuzatish: **Ombor → Kirimlarni boshqarish → mahsulot yoki yetkazuvchini topish → Tahrirlash**. O‘zgarish ta’siri va sababni tekshirib saqlang.
2. Alohida takroriy qarz: **Yetkazib beruvchilar → Hisob-kitob tarixi → kerakli yozuv → Qarz / to‘lovni tahrirlash → Takroriy / xato qarzni olib tashlash**. Yangi qarz qoldig‘ini tekshiring.
3. Omborga bog‘langan asl xaridni oddiy qarz sifatida o‘chirmang; uning **Kirimni boshqarish** tugmasidan foydalaning. Ayrim eski, to‘liq bog‘lanmagan hujjatlar avtomatik tahrirni to‘xtatib, tekshirish xabarini chiqaradi.
4. **Hisobotlar** oynasida Telegramning haqiqiy saqlangan vaqti ko‘rinadi. Sayt yopiq holatda yuborish uchun Google Sheets avtomatik jadvali faol bo‘lishi kerak. Telegram javobi tasdiqlanmasa, qayta yuborishdan oldin botdagi xabarni tekshiring.

## Nimalar o‘zgartirilmadi?

Jonli bazadagi savdo, qarz, xarid, ombor qoldig‘i, maosh yoki tarixiy narxlar qo‘lda tuzatilmadi. Nodir akadagi ikki 198 000₩ yozuvdan qaysi biri xato ekani hujjat bilan aniqlanib, tegishli yozuv bekor qilinishi kerak. Eski 30 000 g / 900₩ sous narxlari, manfiy ombor qoldiqlari va mos kelmagan delivery menyusi taxmin bilan o‘zgartirilmadi.

Yangi baza jadvali: `telegram_daily_deliveries` — filial, hisobot sanasi, yuborish holati, so‘rov raqami, vaqt va xato izohi. Bu jadval biznes operatsiyalarini o‘zgartirmaydi. Google Sheets eksport shakli va versiyasi o‘zgarmadi; yangi Code.gs talab qilinmaydi.

## Tekshiruv

- Alohida mahalliy bazada xarid, sotuv, ombor qaytarilishi, qarzni tahrirlash/bekor qilish, takroriy so‘rovlar va filial ruxsatlari sinovlari bajariladi.
- 198 000₩ naqd pulsiz xarajat kassadan ayrilmasligi; 30 kg sous miqdori va summasi; narxsiz retsept ogohlantirishi tekshiriladi.
- Telegram sinovi haqiqiy botga xabar yubormaydigan sinov muhitida: sayt so‘rovisiz Sheets orqali yuborish, parallel so‘rov, ruxsatsiz kalit, o‘chirilgan bot, kechikkan vaqt, rad etilgan va noaniq javoblar tekshiriladi.
- Haqiqiy Telegramga sayt yopiq holatda kelgani ushbu sinov bilan tasdiqlanmaydi; uni jonli jadvalning keyingi ishga tushishida tekshirish kerak.
