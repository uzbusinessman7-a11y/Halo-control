# INCOMPLETE_SOURCE_NOTICE.md

Bu paket live HALO Digital Menu loyihasini o‘zgartirmaydi va deploy qilmaydi.

## Nima topildi
1. 2026-07-21 sanasidagi `halo-digital-menu.zip` eski source eksporti:
   - index.html
   - app.js
   - style.css
   - README.txt
2. 2026-08-27 sanasidagi keyingi live monitor snapshot:
   - `/api/menu`
   - 17 ta faol menu item
   - promotion
   - SET MENU

## Nima topilmadi
Hozir ishlayotgan `halo-digital-menu.uzbusinessman7.chatgpt.site` versiyasining to‘liq server repository/source exporti, backend API fayllari, DB migration/schema fayllari, joriy rasmlar va font assetlari mavjud Library/connectorlarda topilmadi.

Shu sabab `source-available/` papkasini “joriy live source” deb noto‘g‘ri nomlamadim. Bu — mavjud eng yaqin source eksporti.

## Xavfsizlik uchun almashtirilgan
- `source-available/app.js`: hard-coded admin parol qiymati -> `BU_YERGA_QOYILADI`
- `source-available/index.html`: default admin parol matni -> `BU_YERGA_QOYILADI`
- `source-available/README.txt`: default admin parol matni -> `BU_YERGA_QOYILADI`

Hech qanday API key, token yoki maxfiy qiymat paketga ataylab kiritilmadi.
