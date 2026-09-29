# HALO hisob tizimi tekshiruvi — 2026-09-25

Talab: oldingi sozlash talablaridan qat’i nazar, pul, ombor, qarz va boshqaruv natijalarini izchil hisoblash. Tarixdagi haqiqiy summalar hujjatsiz almashtirilmaydi.

## Tuzatilgan sabablar

- POS Excel summasi hozirgi menyu narxiga almashtirilardi. Endi haqiqiy yakuniy savdo summasi saqlanadi; summa yo‘q surat/kod importi taxmin deb belgilanadi. Net summadan chegirma qayta ayrilmaydi. Haqiqiy 0 ham saqlanadi.
- Takror POS yozuvining summasi o‘zgargani ko‘rinmas edi. Endi hatto 1₩ farq rahbar oynasida to‘xtatiladi. Sana, miqdor, kod, noto‘g‘ri/manfiy summa, ko‘p kunlik jami va fayl yakuni tekshiriladi.
- Xodimga takror qatorni solishtirish uchun kerakli sana, mahsulot va miqdor berilmas edi. Endi shu ma’lumotlar beriladi, tannarx/foyda yuborilmaydi. Xodim eski yozuvni qayta yozmaydi; pul taqqoslashi rahbar oynasida.
- Boshlang‘ich qarz hisobga olinmagani yangi kirimni muddatidan oldin “to‘landi” deb ko‘rsatardi. Bog‘lanmagan to‘lov eng eski qarzga, shu jumladan boshlang‘ich qarzga; aniq kirimga bog‘langan to‘lov o‘sha kirimga ajratiladi. Avans alohida saqlanadi.
- Bir ingredientning aralash narxdagi takror retsept qatorlari birlashtirilganda jami tannarx yo‘qolishi mumkin edi. Endi har qator xarajati yig‘iladi.
- Bir kun ichida xaridning oxirgi narxi tasodifiy ID tartibiga bog‘liq edi. Endi saqlangan kirim ketma-ketligi ishlatiladi. Kirimni bekor qilish narx zanjirini ham tiklaydi.
- Nomi omborda topilmagan mahsulot avtomatik xarajat bo‘lardi. Endi foydalanuvchi nomni tuzatadi yoki xarajat ekanini belgilaydi. AI oldindan ko‘rishda tasnifni ko‘rsatadi; saqlash mavjud tasdiqlash oqimi orqali.
- Hisob oynasi API orqali kirishsiz o‘qilishi va o‘zgartirilishi mumkin edi. Endi rahbar yoki faol xodim sessiyasi kerak; xodim o‘z filialiga cheklanadi, eski terminal yozuvini tahrirlash/o‘chirish rahbarga tegishli.
- Soliq foizi haqiqiy soliqdek va foyda yakuniy natijadek ko‘rsatilardi. Endi foyda boshqaruv uchun hisobiy natija, foiz esa reja zaxirasi deb tushuntiriladi. Saqlangan tarixiy foizlar qayta hisoblanmaydi. Google Sheets ustun nomlari mosligi saqlangan, hisobotga hisob usuli izohi qo‘shilgan.
- Hisob ishonchliligi oynasi takror savdo, noto‘g‘ri summa, manfiy ombor, yetishmagan tannarx, eski POS taxmini, ehtimoliy takror xarajat, to‘lov/pul chiqimi farqi va zararli delivery buyurtmalarini ajratadi. Tekshirish ma’lumotni o‘zgartirmaydi.

## Tekshirilgan asoslar

Mavjud sinovlar savdo/tannarx, delivery ushlanmalari, kun/oy yopish, maosh/avans, ombor kirim/chiqim, MEZANA, yetkazuvchi qarzi, bekor qilish, filiallar, AI tasdiqlashi va eksportlarni qamrab oladi. Yangi sinovlar yuqoridagi regressiyalarni tekshiradi. Import namunasi: 2026-09-23, 25 mahsulot qatori, 84 dona, 782 500₩.

## Hisob chegaralari

- Ishlayotgan bazaning barcha tarixiy summalari bu tekshiruvda chek va bank hujjatlari bilan tasdiqlanmagan. Nodir aka yoki boshqa yetkazuvchining haqiqiy qarzi taxminan o‘zgartirilmagan.
- Ombor bahosi oxirgi kirim narxi, savdo tannarxi saqlangan retsept asosida. Bu to‘liq FIFO/o‘rtacha tortilgan qiymat buxgalteriya registri emas.
- Barcha to‘lov turlari jamlangan POS faylidan qaysi qism naqd/karta/delivery ekanini aniqlab bo‘lmaydi. Ularni yana alohida kiritish takror savdo tug‘diradi; manba qamrovini tekshirish kerak.
- 800 000₩ dan oshgan kunlik qismning 10% bonusi ko‘rsatiladi. Bu hisob maoshga avtomatik yozilmaydi; maoshdagi bonus yozuvi alohida.
- QQS turi, xarid hujjatlari va deklaratsiya davri tasdiqlanmasdan rasmiy soliq majburiyati aniqlanmaydi. Delivery xizmati QQSi umumiy savdo QQSini almashtirmaydi.

## Hisob tamoyillari manbalari

- Koreya NTS: QQS hisoblashda sotuv va xarid QQSi farqlanadi; odatiy va soddalashtirilgan rejimlar bir xil emas: https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7693&mi=2272
- IAS 2: sotilgan zaxira tannarxi tegishli savdo davrida xarajatga o‘tadi; bir xil zaxiralar uchun FIFO yoki o‘rtacha tortilgan qiymat qo‘llanadi: https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/

Sinov va yig‘ish natijalari chiqariladigan commit bilan tekshiriladi. Hech bir avtomatik test haqiqiy kassa, bank yoki qabul qilingan mahsulotning mavjudligini o‘zicha isbotlamaydi.
