# HALO-CONTROL-INTEGRATSIYA.md

## Reja
Taom nomi va narxi faqat HALO Control’da yuritiladi. Digital Menu monitori HALO Control API’dan read-only ma’lumot oladi. HALO Control’da narx o‘zgarsa monitor keyingi refresh/pollingda avtomatik yangilanadi.

## To‘sqinlik qilishi mumkin bo‘lgan joylar
1. **ID mosligi** — Digital Menu item ID va HALO Control product/menu ID bir xil barqaror mappingga ega bo‘lishi kerak.
2. **Variantlar** — bitta taomda chicken/lamb/mix/cheese yoki gram/size variantlari alohida narxga ega; API shu strukturani saqlashi kerak.
3. **Kategoriya va tartib** — Control faqat nom/narx bersa, ekran category/order/visible/badge kabi display metadata’ni qayerda saqlashi aniq bo‘lishi kerak.
4. **Rasmlar** — rasm HALO Control’da boshqariladimi yoki Digital Menu’da qoladimi, bitta authoritative source tanlanishi kerak.
5. **Cache** — Cloudflare/CDN/browser cache narx yangilanishini kechiktirishi mumkin; menu GET uchun cache siyosati va version/updatedAt kerak.
6. **Polling interval** — monitor API’ni haddan tashqari tez chaqirmasligi, lekin narxni tez yangilashi kerak.
7. **Offline holat** — internet uzilsa monitor oxirgi muvaffaqiyatli menyuni ko‘rsatib turishi kerak.
8. **D1 schema** — HALO Control D1’da menu uchun monitor talab qiladigan variant/visibility/order maydonlari bo‘lmasa adapter endpoint kerak bo‘ladi.
9. **CORS/auth** — Digital Menu boshqa origin’dan HALO Control Workers API’ni chaqirsa CORS ruxsati kerak. Monitor uchun write-secret berilmasligi kerak.
10. **Bir nechta ekran/filial** — Kebab/Chicken/Pitsa va kelajakdagi filiallar uchun `branchId`/`screen` filtrlari barqaror bo‘lishi kerak.

Tavsiya etilgan yo‘l: HALO Control’da read-only `/api/digital-menu` endpointi; monitor faqat shu endpointni o‘qiydi. Admin write operatsiyalari HALO Control ichida qoladi.
