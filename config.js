require('dotenv').config();

module.exports = {
  // Server configuration
  PORT: process.env.PORT || 3000,
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  BOT_MODE: process.env.BOT_MODE || 'polling', // 'polling' or 'webhook'
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '', // set in .env (never commit it)
  ADMIN_TELEGRAM_ID: process.env.ADMIN_TELEGRAM_ID || '', // Optional Telegram ID check
  
  // AI Configuration
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  // Supported 15 languages
  LANGUAGES: {
    uz: { code: 'uz', name: 'O‘zbek tili', native: 'O‘zbekcha', flag: '🇺🇿', ttsVoice: 'uz-UZ-MadinaNeural' },
    en: { code: 'en', name: 'Ingliz tili', native: 'English', flag: '🇬🇧', ttsVoice: 'en-US-JennyNeural' },
    ru: { code: 'ru', name: 'Rus tili', native: 'Русский', flag: '🇷🇺', ttsVoice: 'ru-RU-SvetlanaNeural' },
    ar: { code: 'ar', name: 'Arab tili', native: 'العربية', flag: '🇸🇦', ttsVoice: 'ar-SA-HamedNeural' },
    tr: { code: 'tr', name: 'Turk tili', native: 'Türkçe', flag: '🇹🇷', ttsVoice: 'tr-TR-AhmetNeural' },
    fr: { code: 'fr', name: 'Fransuz tili', native: 'Français', flag: '🇫🇷', ttsVoice: 'fr-FR-DeniseNeural' },
    de: { code: 'de', name: 'Nemis tili', native: 'Deutsch', flag: '🇩🇪', ttsVoice: 'de-DE-KatjaNeural' },
    es: { code: 'es', name: 'Ispan tili', native: 'Español', flag: '🇪🇸', ttsVoice: 'es-ES-ElviraNeural' },
    fa: { code: 'fa', name: 'Fors tili', native: 'فارسی', flag: '🇮🇷', ttsVoice: 'fa-IR-DilaraNeural' },
    zh: { code: 'zh', name: 'Xitoy tili', native: '中文', flag: '🇨🇳', ttsVoice: 'zh-CN-XiaoxiaoNeural' },
    ja: { code: 'ja', name: 'Yapon tili', native: '日本語', flag: '🇯🇵', ttsVoice: 'ja-JP-NanamiNeural' },
    ko: { code: 'ko', name: 'Koreys tili', native: '한국어', flag: '🇰🇷', ttsVoice: 'ko-KR-SunHiNeural' },
    it: { code: 'it', name: 'Italyan tili', native: 'Italiano', flag: '🇮🇹', ttsVoice: 'it-IT-ElsaNeural' },
    pt: { code: 'pt', name: 'Portugal tili', native: 'Português', flag: '🇵🇹', ttsVoice: 'pt-BR-FranciscaNeural' },
    hi: { code: 'hi', name: 'Hind tili', native: 'हिन्दी', flag: '🇮🇳', ttsVoice: 'hi-IN-SwaraNeural' }
  },

  // User proficiency levels
  LEVELS: {
    beginner: { id: 'beginner', label: 'Beginner (Boshlang‘ich)', cefr: 'A1-pre', desc: 'Oddiy so‘zlar va fonetik talaffuz' },
    elementary: { id: 'elementary', label: 'Elementary (Oddiy)', cefr: 'A1', desc: 'Asosiy kundalik so‘zlar va qisqa misollar' },
    pre_intermediate: { id: 'pre_intermediate', label: 'Pre-Intermediate (O‘rta-quyi)', cefr: 'A2', desc: 'Oddiy suhbat va asosiy grammatika' },
    intermediate: { id: 'intermediate', label: 'Intermediate (O‘rta)', cefr: 'B1', desc: 'Tabiiy matnlar va erkin muloqot' },
    upper_intermediate: { id: 'upper_intermediate', label: 'Upper-Intermediate (O‘rta-yuqori)', cefr: 'B2', desc: 'Keng so‘z boyligi va sinonimlar' },
    advanced: { id: 'advanced', label: 'Advanced (Ilg‘or)', cefr: 'C1', desc: 'Murakkab uslub va adabiy til' },
    hard: { id: 'hard', label: 'Hard (Akademik)', cefr: 'C2+', desc: 'Chuqur morfologiya va etimologiya' },
    a1: { id: 'a1', label: 'A1 — Beginner', cefr: 'A1', desc: 'Boshlang‘ich daraja' },
    a2: { id: 'a2', label: 'A2 — Elementary', cefr: 'A2', desc: 'Elementar daraja' },
    b1: { id: 'b1', label: 'B1 — Intermediate', cefr: 'B1', desc: 'Mustaqil o‘rta daraja' },
    b2: { id: 'b2', label: 'B2 — Upper-Intermediate', cefr: 'B2', desc: 'Erkin muloqot darajasi' },
    c1: { id: 'c1', label: 'C1 — Advanced', cefr: 'C1', desc: 'Professional daraja' },
    c2: { id: 'c2', label: 'C2 — Mastery', cefr: 'C2', desc: 'Mukammal daraja' }
  },

  // Tier parameters & daily limits
  TIERS: {
    free: {
      name: 'FREE',
      title: 'Oddiy (Bepul)',
      translateDaily: 30,
      voiceDaily: 20,
      listeningDaily: 5,
      generatorQuota: 0,
      maxVoiceSeconds: 120
    },
    pro: {
      name: 'PRO',
      title: 'PRO ⭐️',
      priceStars: 50,
      durationDays: 30,
      translateDaily: 150,
      voiceDaily: 60,
      listeningDaily: 20,
      generatorQuota: 20,
      maxVoiceSeconds: 120
    },
    promax: {
      name: 'PRO MAX',
      title: 'PRO MAX 🌟',
      priceStars: 120,
      durationDays: 90,
      translateDaily: 500,
      voiceDaily: 200,
      listeningDaily: 60,
      generatorQuota: 50,
      maxVoiceSeconds: 120
    }
  },

  // Additional Telegram Stars pricing
  PRICES: {
    PRO_MONTH: 50,
    PROMAX_3MONTHS: 120,
    GENERATOR_UNLOCK: 250,
    GENERATOR_REFILL_10STARS: 10,
    GENERATOR_REFILL_CREDITS: 20,
    PAY_SUPPORT_RECOMMENDED: 1000
  },

  // Popular Countries & Timezones
  COUNTRIES: [
    {
      code: 'UZ',
      name: 'O‘zbekiston 🇺🇿',
      tz: 'Asia/Tashkent',
      regions: [
        'Toshkent shahri', 'Toshkent viloyati', 'Samarqand', 'Buxoro',
        'Andijon', 'Farg‘ona', 'Namangan', 'Qashqadaryo (Qarshi)',
        'Surxondaryo (Termiz)', 'Xorazm (Urganch)', 'Navoiy', 'Jizzax',
        'Sirdaryo (Guliston)', 'Qoraqalpog‘iston (Nukus)'
      ]
    },
    {
      code: 'RU',
      name: 'Rossiya 🇷🇺',
      tz: 'Europe/Moscow',
      regions: ['Moskva', 'Sankt-Peterburg', 'Qozon', 'Yekaterinburg', 'Novosibirsk', 'Vladivostok']
    },
    {
      code: 'TR',
      name: 'Turkiya 🇹🇷',
      tz: 'Europe/Istanbul',
      regions: ['Istanbul', 'Anqara', 'Izmir', 'Bursa', 'Antaliya']
    },
    {
      code: 'AE',
      name: 'BAA / UAE 🇦🇪',
      tz: 'Asia/Dubai',
      regions: ['Dubay', 'Abu Dabi', 'Sharja', 'Ajman']
    },
    {
      code: 'SA',
      name: 'Saudiya Arabistoni 🇸🇦',
      tz: 'Asia/Riyadh',
      regions: ['Ar-Riyod', 'Jidda', 'Makka', 'Madina', 'Dammom']
    },
    {
      code: 'EG',
      name: 'Misr 🇪🇬',
      tz: 'Africa/Cairo',
      regions: ['Qohira', 'Iskandariya', 'Giza']
    },
    {
      code: 'KZ',
      name: 'Qozog‘iston 🇰🇿',
      tz: 'Asia/Almaty',
      regions: ['Ostona', 'Olmaota', 'Chimkent', 'Aqtau', 'Atirau']
    },
    {
      code: 'KG',
      name: 'Qirg‘iziston 🇰🇬',
      tz: 'Asia/Bishkek',
      regions: ['Bishkek', 'O‘sh', 'Jalolobod']
    },
    {
      code: 'TJ',
      name: 'Tojikiston 🇹🇯',
      tz: 'Asia/Dushanbe',
      regions: ['Dushanbe', 'Xo‘jand', 'Ko‘lob']
    },
    {
      code: 'KR',
      name: 'Janubiy Koreya 🇰🇷',
      tz: 'Asia/Seoul',
      regions: ['Seul', 'Pusan', 'Incheon', 'Tegu']
    },
    {
      code: 'DE',
      name: 'Germaniya 🇩🇪',
      tz: 'Europe/Berlin',
      regions: ['Berlin', 'Myunxen', 'Frankfurt', 'Gamburg', 'Kyoln']
    },
    {
      code: 'US',
      name: 'AQSH 🇺🇸',
      tz: 'America/New_York',
      regions: ['Nyu-York', 'Chikago', 'Los-Anjeles', 'Vashington', 'Xyuston']
    },
    {
      code: 'GB',
      name: 'Buyuk Britaniya 🇬🇧',
      tz: 'Europe/London',
      regions: ['London', 'Manchester', 'Birmingem', 'Glazgo']
    },
    {
      code: 'JP',
      name: 'Yaponiya 🇯🇵',
      tz: 'Asia/Tokyo',
      regions: ['Tokio', 'Osaka', 'Kioto', 'Yokogama']
    },
    {
      code: 'CN',
      name: 'Xitoy 🇨🇳',
      tz: 'Asia/Shanghai',
      regions: ['Pekin', 'Shanxay', 'Guanchjou', 'Shenjen']
    }
  ]
};
