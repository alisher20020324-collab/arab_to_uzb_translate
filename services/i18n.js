const config = require('../config');
const { toScript } = require('./transliterate');

const MESSAGES = {
  welcome: {
    uz: `🌟 **Arab Tarjima Botiga xush kelibsiz!**\n\nBu bot 15 ta dunyo tillari o‘rtasida matn va ovozli xabarlarni professional darajada tarjima qiladi, listening materiallarini tahlil qiladi va yangi darsliklar yaratadi.\n\n✨ **Asosiy imkoniyatlar:**\n• 🌐 **15 ta til:** Istalgan tildan istalgan tilga sifatli tarjima\n• 🎙 **Ovozli xabar tarjimasi:** 2 daqiqagacha bo‘lgan ovozlarni tushunish va tarjima qilish\n• 🎧 **Listening tahlili:** Audio va rasm (kitob varag‘i)ni solishtirish va xatolarni topish\n• ⚡ **Listening Generator:** Ovozli mashqlar va testlar yaratish\n• 📚 **13 ta bilim darajasi:** Beginner dan C2 gacha moslashuvchan izohlar\n• 💎 **Telegram Stars:** Qulay va rasmiy Premium tariflar\n\nQuyidagi menyu tugmalaridan birini tanlang yoki to‘g‘ridan-to‘g‘ri matn/ovoz yuboring!`,
    en: `🌟 **Welcome to Arab Translation Bot!**\n\nTranslate text and voice messages between 15 world languages, analyze listening exercises, and generate custom audio study materials.\n\n✨ **Main Features:**\n• 🌐 Any-to-Any translation across 15 languages\n• 🎙 Voice message translation (up to 2 minutes)\n• 🎧 Listening analysis (compare audio with textbook image)\n• ⚡ Listening generator (create audio & study exercises)\n• 📚 13 proficiency levels from Beginner to C2\n• 💎 Telegram Stars official premium system\n\nChoose an option below or send text/voice directly!`,
    ru: `🌟 **Добро пожаловать в Arab Translation Bot!**\n\nПрофессиональный перевод текста и голосовых сообщений между 15 языками мира, анализ аудирования и генерация учебных материалов.\n\n✨ **Основные возможности:**\n• 🌐 Перевод между 15 языками в любом направлении\n• 🎙 Голосовой перевод (до 2 минут)\n• 🎧 Анализ аудирования (сравнение аудио и текста на фото)\n• ⚡ Генератор аудирования (создание аудио и упражнений)\n• 📚 13 уровней сложности от Beginner до C2\n• 💎 Официальный Premium через Telegram Stars\n\nВыберите действие в меню ниже или отправьте текст/голос!`,
    ar: `🌟 **مرحبًا بكم في بوت الترجمة العربية الذكي!**\n\nترجمة النصوص والرسائل الصوتية بين 15 لغة عالمية، وتحليل مهارات الاستماع وتوليد تمارين صوتية احترافية.\n\n✨ **المميزات الرئيسية:**\n• 🌐 ترجمة فورية وشاملة بين 15 لغة\n• 🎙 ترجمة الرسائل الصوتية حتى دقيقتين\n• 🎧 تحليل نصوص الاستماع بمطابقة الصوت مع الصورة\n• ⚡ توليد تمارين استماع صوتية متكاملة\n• 📚 مستويات تعليمية من المبتدئ إلى C2\n• 💎 اشتراكات بريميوم عبر نجوم تليجرام\n\nاختر من القائمة أدناه أو أرسل نصًا/رسالة صوتية مباشرة!`
  },

  help: {
    uz: `📖 **BOTDAN FOYDALANISH TO‘LIQ QO‘LLANMASI**\n\n` +
      `Quyidagi komandalardan foydalanishingiz mumkin:\n\n` +
      `• /start — Botni ishga tushirish va til/yozuvni tanlash\n` +
      `• /translate — Matn tarjima qilish (15 ta til o‘rtasida)\n` +
      `• /voice — 2 daqiqagacha bo‘lgan ovozli xabarlarni tarjima qilish\n` +
      `• /listening — Audio va rasm yuborib, listening xatolarini solishtirish\n` +
      `• /generator — Yangi listening matni va ovozli faylini yaratish\n` +
      `• /status — Hisob holati, qolgan limitlar va darajani ko‘rish\n` +
      `• /limit — Kunlik limitlar va 00:00 gacha qolgan vaqtni tekshirish\n` +
      `• /premium — Telegram Stars orqali PRO va PRO MAX tariflarini olish\n` +
      `• /paysupport — Bot loyihasini rivojlantirish uchun 1000 Stars xayriya\n` +
      `• /delete — Bot bilan chat tarixini tozalash\n` +
      `• /admin — Administrator maxsus boshqaruv paneli\n` +
      `• /logout — Admin paneldan xavfsiz chiqish\n\n` +
      `👥 **Guruhlarda ishlash:**\n` +
      `Botni guruhga qo‘shganda, u barcha xabarlarga javob bermaydi. Bot ishlashi uchun uni nomi bilan chaqiring:\n` +
      `Masalan: \`@ArabTarjimaBot tarjima qil Ushbu kitob juda foydali\`\n` +
      `yoki xabarga reply qilib \`@ArabTarjimaBot\` deb yozing.`,
    en: `📖 **COMPLETE USER GUIDE**\n\n` +
      `Available commands:\n\n` +
      `• /start — Start bot and select language/script\n` +
      `• /translate — Translate text between 15 languages\n` +
      `• /voice — Translate voice messages up to 2 minutes\n` +
      `• /listening — Compare audio & image to find listening errors\n` +
      `• /generator — Generate complete audio listening exercises\n` +
      `• /status — Account info, limits and proficiency level\n` +
      `• /limit — Daily limit status and midnight reset countdown\n` +
      `• /premium — Upgrade to PRO & PRO MAX via Telegram Stars\n` +
      `• /paysupport — Donate 1,000 Telegram Stars to support the author\n` +
      `• /delete — Clear chat history with the bot\n` +
      `• /admin — Administrator control panel\n` +
      `• /logout — Securely log out of admin session\n\n` +
      `👥 **Group chats:** Bot only responds when directly tagged: \`@ArabTarjimaBot translate ...\``
  }
};

/**
 * Get localized string
 */
function msg(key, lang = 'uz', script = 'latin') {
  const dict = MESSAGES[key];
  if (!dict) return '';
  const text = dict[lang] || dict.uz || dict.en || '';
  if (lang === 'uz' && script === 'cyrillic') {
    return toScript(text, 'cyrillic');
  }
  return text;
}

/**
 * Main reply keyboard
 */
function getMainKeyboard(lang = 'uz', script = 'latin') {
  const buttons = [
    ['🌐 Tarjima', '🎙 Ovozli tarjima'],
    ['🎧 Listening', '⚡ Generator'],
    ['📊 Status', '💎 Premium'],
    ['⏳ Limitlar', '⚙️ Sozlamalar & Til'],
    ['ℹ️ Yordam', '💖 Qo‘llab-quvvatlash']
  ];

  const localized = buttons.map(row => 
    row.map(btn => {
      if (lang === 'uz' && script === 'cyrillic') {
        return toScript(btn, 'cyrillic');
      }
      return btn;
    })
  );

  return {
    keyboard: localized,
    resize_keyboard: true,
    persistent: true
  };
}

/**
 * 15 languages selection inline keyboard
 */
function getLanguageKeyboard() {
  const langs = Object.values(config.LANGUAGES);
  const rows = [];
  let currentRow = [];

  for (let i = 0; i < langs.length; i++) {
    const l = langs[i];
    currentRow.push({
      text: `${l.flag} ${l.native}`,
      callback_data: `lang_${l.code}`
    });
    if (currentRow.length === 2 || i === langs.length - 1) {
      rows.push(currentRow);
      currentRow = [];
    }
  }

  return { inline_keyboard: rows };
}

/**
 * Uzbek script selection inline keyboard
 */
function getUzbekScriptKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🇺🇿 O‘zbekcha — Lotin', callback_data: 'script_latin' },
        { text: '🇺🇿 Ўзбекча — Кирилл', callback_data: 'script_cyrillic' }
      ]
    ]
  };
}

/**
 * Level selection inline keyboard
 */
function getLevelKeyboard(currentLevel = 'intermediate', script = 'latin') {
  const levels = Object.values(config.LEVELS);
  const rows = [];
  let currentRow = [];

  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const isCurrent = lvl.id === currentLevel ? '✅ ' : '';
    const label = toScript(lvl.label, script);
    currentRow.push({
      text: `${isCurrent}${label}`,
      callback_data: `lvl_${lvl.id}`
    });

    if (currentRow.length === 2 || i === levels.length - 1) {
      rows.push(currentRow);
      currentRow = [];
    }
  }

  rows.push([
    { text: toScript('🔙 Ortga', script), callback_data: 'settings_menu' }
  ]);

  return { inline_keyboard: rows };
}

/**
 * Translation language selector inline keyboard
 */
function getTranslateLanguageKeyboard(mode = 'target', currentLang = 'ar', script = 'latin') {
  const langs = Object.values(config.LANGUAGES);
  const rows = [];
  let currentRow = [];

  // Auto-detect option for source language
  if (mode === 'source') {
    rows.push([
      {
        text: currentLang === 'auto' ? '✅ 🔍 Avtomatik aniqlash' : '🔍 Avtomatik aniqlash',
        callback_data: `src_auto`
      }
    ]);
  }

  for (let i = 0; i < langs.length; i++) {
    const l = langs[i];
    const isCurrent = l.code === currentLang ? '✅ ' : '';
    currentRow.push({
      text: `${isCurrent}${l.flag} ${l.name}`,
      callback_data: `${mode}_${l.code}`
    });

    if (currentRow.length === 2 || i === langs.length - 1) {
      rows.push(currentRow);
      currentRow = [];
    }
  }

  rows.push([
    { text: toScript('🔙 Yopish', script), callback_data: 'close_menu' }
  ]);

  return { inline_keyboard: rows };
}

/**
 * Premium tiers inline keyboard
 */
function getPremiumKeyboard(script = 'latin') {
  return {
    inline_keyboard: [
      [
        {
          text: '⭐️ PRO — 50 Stars (1 oy)',
          callback_data: 'buy_pro'
        }
      ],
      [
        {
          text: '🌟 PRO MAX — 120 Stars (3 oy)',
          callback_data: 'buy_promax'
        }
      ],
      [
        {
          text: '⚡ Generator ochish — 250 Stars',
          callback_data: 'buy_gen_unlock'
        }
      ],
      [
        {
          text: '🔄 20 ta Generator limiti — 10 Stars',
          callback_data: 'buy_gen_refill'
        }
      ],
      [
        {
          text: toScript('📊 Mening statusim', script),
          callback_data: 'view_status'
        }
      ]
    ]
  };
}

module.exports = {
  msg,
  getMainKeyboard,
  getLanguageKeyboard,
  getUzbekScriptKeyboard,
  getLevelKeyboard,
  getTranslateLanguageKeyboard,
  getPremiumKeyboard
};
