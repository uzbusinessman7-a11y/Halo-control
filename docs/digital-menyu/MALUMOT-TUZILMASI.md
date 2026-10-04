# MALUMOT-TUZILMASI.md

## Joriy saqlangan ma’lumot shakli
Eng so‘nggi mavjud snapshot JSON ko‘rinishida quyidagi obyektlarni ko‘rsatadi.

### Menu item
- `id` — noyob taom ID.
- `name` — snapshotdagi taom nomi.
- `category` — `Kebab`, `Chicken`, `Pitsa`.
- `visible` — ekranda ko‘rsatish.
- `soldOut` — sotuvda yo‘q holati.
- `variants[]` — variantlar.
  - `label`
  - `price`

### Promotion
- `visible`
- `title`
- `description`
- `price`
- `oldPrice`
- `badge`

### SET offer
- `visible`
- `title`
- `description`
- `price`

## Bog‘lanish
`category -> items -> variants`

Promo/SET offer snapshotda itemlardan alohida yuqori darajadagi obyekt sifatida saqlangan.

## Noma’lum / joriy manbada tasdiqlanmagan
To‘liq backend/baza sxemasi mavjud bo‘lmagani uchun quyidagilarni uydirib yozmadim:
- fizik DB jadval nomlari va DDL;
- filial jadvali;
- rasm asset jadvali;
- slayd jadvali;
- ko‘p tilli nom/tavsifning joriy DB ustunlari;
- foreign key/indexlar.

`source-available/` ichidagi eski eksport esa `localStorage` asosida ishlaydi; u hozirgi `/api/menu` backendli versiya bilan bir xil emas.
