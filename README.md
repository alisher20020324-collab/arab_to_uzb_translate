# 🌟 ARAB TARJIMA BOT — PROFESSIONAL MULTI-LANGUAGE TELEGRAM BOT

15 ta dunyo tillari o‘rtasida matn va ovozli xabarlarni professional darajada tarjima qiluvchi, listening mashqlarini tahlil qiluvchi va yangi audio-darsliklar yaratuvchi aqlli Telegram bot.

---

## 🚀 Texnik Asos va Afzalliklar

- **Backend:** Node.js (v20+)
- **Framework:** Express.js (`app.js`)
- **Telegram Bot API:** JavaScript (`node-telegram-bot-api`)
- **Ma'lumotlar bazasi:** SQLite (`node:sqlite` DatabaseSync — yuqori tezlik, faylli xotira, nol tashqi C++ bog‘liqlik)
- **Sun'iy intellekt (AI):** Google Gemini 2.5 Flash Multimodal (Matn, Ovoz STT, Rasm OCR tahlili) + MyMemory zaxira tarjima tizimi
- **Ovoz sintezi (TTS):** Microsoft Edge Neural TTS — 15 ta til uchun insoniy tabiiy ovozlar
- **To‘lov tizimi:** Telegram Stars (XTR) rasmiy to‘lov mexanizmi
- **Yozuv turi:** O‘zbekcha Lotin va Kirill to‘liq avtomatik ikki tomonlama konvertori

---

## 📋 Bot Imkoniyatlari va Komandalar

| Komanda | Vazifasi va Tavsifi |
| :--- | :--- |
| `/start` | Til tanlash (15 ta til) va O‘zbek tili uchun Lotin / Kirill yozuvini belgilash |
| `/translate` | 15 ta tilning istalgan biridan istalgan boshqasiga darajaga mos tarjima |
| `/voice` | 2 daqiqagacha bo‘lgan ovozli xabarlarni eshitish va tarjima qilish |
| `/status` | Foydalanuvchi hisobi, ID, tanlangan daraja, limitlar va premium muddati |
| `/limit` | Qolgan kunlik limitlar va foydalanuvchi mahalliy vaqti bilan 00:00 gacha qolgan vaqt |
| `/listening` | Audio va darslik rasmini solishtirish, xatolarni aniqlash va tekshirish |
| `/generator` | Istalgan tilda audio va matnli yangi listening darslik yaratish |
| `/premium` | Telegram Stars orqali PRO (50 Stars) va PRO MAX (120 Stars) tariflari |
| `/paysupport` | Loyihani qo‘llab-quvvatlash uchun 1 000 Telegram Stars xayriya qilish |
| `/delete` | Bot tomonidan yuborilgan chat xabarlarini tozalash |
| `/admin` | `.env` dagi ADMIN_PASSWORD orqali kiriladigan boshqaruv paneli |
| `/logout` | Admin paneldan xavfsiz chiqish |
| `/help` | Botdan foydalanish bo‘yicha to‘liq qo‘llanma |

---

## 🌐 Qo‘llab-quvvatlanadigan 15 ta Til

1. 🇺🇿 **O‘zbek tili** (Lotin va Kirill yozuvlarida)
2. 🇬🇧 **Ingliz tili** (English)
3. 🇷🇺 **Rus tili** (Русский)
4. 🇸🇦 **Arab tili** (العربية — to‘liq harakatlar/tashkeel bilan)
5. 🇹🇷 **Turk tili** (Türkçe)
6. 🇫🇷 **Fransuz tili** (Français)
7. 🇩🇪 **Nemis tili** (Deutsch)
8. 🇪🇸 **Ispan tili** (Español)
9. 🇮🇷 **Fors tili** (فارسی)
10. 🇨🇳 **Xitoy tili** (中文)
11. 🇯🇵 **Yapon tili** (日本語)
12. 🇰🇷 **Koreys tili** (한국어)
13. 🇮🇹 **Italyan tili** (Italiano)
14. 🇵🇹 **Portugal tili** (Português)
15. 🇮🇳 **Hind tili** (हिन्दी)

---

## 📚 13 ta Bilim Darajasi (CEFR)

Bot foydalanuvchining darajasiga qarab tarjimaning murakkabligini, fonetik transkripsiyasini, tushuntirish va misollarni moslashtiradi:
- **Beginner**, **Elementary**, **Pre-Intermediate**, **Intermediate**, **Upper-Intermediate**, **Advanced**, **Hard**
- **A1**, **A2**, **B1**, **B2**, **C1**, **C2**

---

## 💎 Tariflar va Telegram Stars

| Tarif | Narxi | Muddati | /translate | /voice | /listening | /generator |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FREE** | Bepul | Doimiy | 30 ta / kun | 20 ta / kun | 5 ta / kun | Qo‘shimcha |
| **PRO ⭐️** | 50 Stars | 1 oy (30 kun) | 150 ta / kun | 60 ta / kun | 20 ta / kun | 20 ta sovg‘a |
| **PRO MAX 🌟** | 120 Stars | 3 oy (90 kun) | 500 ta / kun | 200 ta / kun | 60 ta / kun | 50 ta sovg‘a |

- **Generator funksiyasini ochish:** 250 Stars
- **20 ta qo‘shimcha Generator krediti:** 10 Stars
- **Loyiha xayriyasi:** 1 000 Stars

---

## 🔐 Administrator Paneli (/admin)

- **Admin paroli:** faqat `.env` faylidagi `ADMIN_PASSWORD` da saqlanadi (GitHub'ga yuklanmaydi)
- Imkoniyatlar:
  - Barcha foydalanuvchilar ro‘yxati (sahifalangan)
  - Foydalanuvchilarni ID yoki username bo‘yicha qidirish
  - Limitlarni oshirish (+50 ta) yoki nolga tushirish
  - Foydalanuvchilarga PRO yoki PRO MAX tarifini berish
  - Botning umumiy statistikasi va Stars tushumlari
- Paneldan chiqish: `/logout`

---

## 👥 Guruhlarga Qo‘shish Qoidasi

Bot guruhga qo‘shilganda barcha xabarlarga ketma-ket javob qaytarmaydi (spamsiz rejim).
Bot faqat o‘zining nomi tilga olinganda javob beradi:
- `@ArabTarjimaBot tarjima qil Ushbu kitob juda qiziqarli`
- Yoki guruhdagi biror xabarga reply qilib `@ArabTarjimaBot` yozilganda.

---

## ⚙️ O‘rnatish va Ishga Tushirish

### 1. Bog‘liqliklarni o‘rnatish
```bash
npm install
```

### 2. Sozlamalar (.env fayli)
`.env` faylini oching va bot ma'lumotlarini kiriting:
```env
PORT=3000
BOT_TOKEN=7123456789:AAF...SizningTelegramTokeningiz
BOT_MODE=polling
ADMIN_PASSWORD=o'zingizning_parolingiz
ADMIN_TELEGRAM_ID=SizningTelegramIDraqamingiz
GEMINI_API_KEY=AIzaSy...SizningGeminiKalitingiz
GEMINI_MODEL=gemini-2.5-flash
```

> **Eslatma:**
> - `BOT_TOKEN` — Telegramda [@BotFather](https://t.me/BotFather) orqali olinadi.
> - `GEMINI_API_KEY` — [Google AI Studio](https://aistudio.google.com/) orqali bepul olinadi.

### 3. Testlarni tekshirish
```bash
node test/test_all.js
```

### 4. Botni ishga tushirish
```bash
npm start
# yoki kuzatuv rejimida:
npm run dev
```

Server ishga tushgach:
- Express HTTP server `http://localhost:3000` manzilida ishlaydi.
- Telegram Bot polling yoki webhook orqali xabarlarni qabul qiladi.
