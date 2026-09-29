# HALO Control — o'z Cloudflare akkauntiga ko'chish

Maqsad: tizimni ChatGPT Sites'dan Otabekning o'z Cloudflare akkauntiga ko'chirish.
Kod GitHub'da, sayt Cloudflare'da, ChatGPT kerak emas.

**Asosiy qoida:** eski sayt (`halo-control.uzbusinessman7.chatgpt.site`) oxirgi bosqichgacha
ishlayveradi. Yangi sayt avval bo'sh bazada sinaladi, keyin ma'lumot ko'chiriladi,
raqamlar wonma-won solishtiriladi. Faqat shundan keyin o'tiladi.

## Kodda nima o'zgardi (ChatGPT Sites uchun hech narsa o'zgarmaydi)

| Fayl | O'zgarish |
|---|---|
| `vite.config.ts` | `HALO_*` o'zgaruvchilari berilsa, o'z D1/R2/worker nomi ishlatiladi. Berilmasa — asl qiymatlar. |
| `worker/owner-auth.ts` | ChatGPT kirishi o'rniga email + parol. Soxta `oai-authenticated-*` sarlavhalar o'chiriladi. |
| `worker/index.ts` | Har bir so'rov ilovaga yetishdan oldin `owner-auth` orqali o'tadi. |
| `app/api/assistant/route.ts` | Telegram webhook manzili saytning haqiqiy manzilidan olinadi. |

Rahbar kirishi `/signin-with-chatgpt` manzilida qoladi (eski havolalar ishlayveradi),
lekin endi o'z email/parol sahifasi ochiladi. Xodimlar kirishi (PIN) o'zgarmagan.

## Cloudflare sozlamalari

### 1. D1 baza
Workers & Pages → D1 SQL Database → Create → nomi: `halo-db`.
Database ID nusxasini oling (maxfiy emas).

### 2. R2 (rasmlar uchun, ixtiyoriy)
R2 yoqish uchun Cloudflare karta talab qiladi (10 GB gacha bepul).
Yoqilmasa, rasm yuklash "ombor ulanmagan" deydi, qolgan hammasi ishlaydi.
Yoqilsa: bucket nomi `halo-files`.

### 3. Worker va GitHub
Workers & Pages → Create → Import a repository → `uzbusinessman7-a11y/Halo-control`.

- Project/Worker nomi: `halo-control`
- Production branch: `main` (sinov bosqichida — ko'chish branch'i)
- Build command: `npm run build`
- Deploy command: `npm run deploy:cloudflare`
  (`scripts/cloudflare-deploy.mjs`: build natijasidan wrangler sozlamasini yozadi,
  D1 migratsiyalarini qo'llaydi va joylaydi)

**Build variables** (build paytida):

| Nomi | Qiymati |
|---|---|
| `HALO_WORKER_NAME` | `halo-control` |
| `HALO_D1_DATABASE_ID` | D1 ID |
| `HALO_D1_DATABASE_NAME` | `halo-db` |
| `HALO_R2_BUCKET_NAME` | `halo-files` (R2 yoqilgan bo'lsa) |
| `NODE_VERSION` | `22` |

### 4. Secretlar (Settings → Variables and Secrets → Secret)

| Nomi | Nima |
|---|---|
| `HALO_OWNER_EMAIL` | ChatGPT'dagi rahbar emaili bilan **bir xil** (ko'chirilgan baza shu emailni rahbar deb biladi) |
| `HALO_OWNER_PASSWORD` | kamida 12 belgi, faqat Otabek biladi |
| `HALO_AUTH_SECRET` | kamida 32 tasodifiy belgi |
| `OPENAI_API_KEY` | ixtiyoriy — faqat AI yordamchi uchun |

Secretlar hech qachon kodga, GitHub'ga yoki chatga yozilmaydi.
Parol o'zgartirilsa, barcha eski kirishlar avtomatik bekor bo'ladi.

## Ko'chish tartibi

1. Bo'sh bazada deploy → kirish, xodim sahifasi, savdo kiritish sinovi.
2. Eski saytdan zaxira (Integratsiyalar → zaxira yuklab olish) + D1 jadvallari eksporti.
3. Yangi bazaga import → har bir filial uchun sotuv, qarz, ombor, kassa qoldiqlari
   eski sayt bilan wonma-won solishtiriladi.
4. Google Sheets `Code.gs` → `endpoint` yangi manzilga o'zgartiriladi.
5. Telegram bot webhook yangi manzilga qayta ulanadi (bot boshqa tizimga
   ulanganini ilova o'zi tekshiradi — bu himoya).
6. Xodimlarga yangi manzil beriladi. Eski sayt faqat o'qish uchun zaxira bo'lib qoladi.

## Sinovlar

- `tests/owner-auth.test.mjs` — kirish xavfsizligi (10 ta sinov).
- `tests/sale-cost-whole-won.test.mjs` — 1₩ qoidasi.
- Barcha testlar: `node --experimental-transform-types --test tests/*.test.mjs`
