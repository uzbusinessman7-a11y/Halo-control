# API.md

## Muhim holat
Saqlangan eng so‘nggi monitor snapshotida ekran ma’lumot manbai quyidagicha qayd etilgan:

`/api/menu` — `GET`

To‘liq joriy server manba kodi bu eksportda mavjud emas. Shuning uchun quyidagi hujjat **saqlangan snapshot va oldingi loyiha ma’lumotlariga asoslangan**, noma’lum joylar taxmin qilinmagan.

## GET /api/menu
- Kim chaqiradi: monitor ekrani.
- Vazifa: kategoriya/taom variantlari, narxlar, ko‘rinish holati, sold-out holati va promo/SET ma’lumotlarini olish.
- Request body: yo‘q.
- Saqlangan javob shakli:

```json
{
  "promotion": {
    "visible": false,
    "title": "HALO COMBO",
    "description": "2 ta Chicken Kebab + 2 ta Cola",
    "price": 21900,
    "oldPrice": 27000,
    "badge": "−19%"
  },
  "setOffer": {
    "visible": true,
    "title": "SET MENU",
    "description": "Drink + french fries",
    "price": 3900
  },
  "items": [
    {
      "id": "item-...",
      "name": "TANDIR LAVASH",
      "category": "Kebab",
      "visible": true,
      "soldOut": false,
      "variants": [
        {"label": "Tandir lavash / chicken", "price": 12900}
      ]
    }
  ]
}
```

- Himoya: saqlangan materiallarda GET endpoint uchun API kalit/parol talabi ko‘rsatilmagan. Joriy implementatsiya manbasi yo‘qligi sababli “ochiq” deb qat’iy tasdiqlanmaydi.
- Yangilanish intervali: joriy ekran kodida necha soniyada bir qayta chaqirilishi saqlangan manbalarda topilmadi.

## Admin API
Saqlangan snapshot adminning yozish endpointlarini ko‘rsatmaydi. Joriy backend kodi olinmagani sabab POST/PUT/PATCH/DELETE manzillarini uydirib yozmadim.

## Monitor URL variantlari
Oldingi loyiha yozuvlarida monitor tanlash uchun:
- `?screen=kebab`
- `?screen=chicken`
- `?screen=pitsa`

variantlari ishlatilgani qayd etilgan. Ba’zi eski yozuvlarda `/tv/kebab`, `/tv/chicken`, `/tv/pitsa` variantlari ham tilga olingan. Joriy deploy kodi bo‘lmagani sabab qaysi biri hozir canonical ekanini bu paket tasdiqlamaydi.
