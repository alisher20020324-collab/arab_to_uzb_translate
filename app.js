require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const db = require('./database');
const { toScript, latinToCyrillic } = require('./services/transliterate');
const { getTimezoneInfo, findCountry } = require('./services/timezones');
const { generateSpeechAudio, cleanupAudioFile } = require('./services/tts');
const {
  translateText,
  transcribeAndTranslateVoice,
  analyzeListeningTask,
  generateListeningMaterial
} = require('./services/ai');
const {
  msg,
  getMainKeyboard,
  getLanguageKeyboard,
  getUzbekScriptKeyboard,
  getLevelKeyboard,
  getTranslateLanguageKeyboard,
  getPremiumKeyboard
} = require('./services/i18n');

// ==============================================================================
// 1. EXPRESS APPLICATION SETUP
// ==============================================================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health and Status endpoints
app.get('/', (req, res) => {
  const stats = db.getStats();
  res.json({
    status: 'online',
    bot: 'Arab Tarjima Bot',
    version: '2.0.0',
    uptimeSeconds: Math.floor(process.uptime()),
    stats
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: Date.now() });
});

// Admin web view of stats
app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

// Start Express HTTP Server
const server = app.listen(config.PORT, () => {
  console.log(`🚀 Express server running on port ${config.PORT}`);
});

// ==============================================================================
// 2. TELEGRAM BOT INITIALIZATION
// ==============================================================================
let bot;
if (config.BOT_TOKEN) {
  if (config.BOT_MODE === 'webhook' && config.WEBHOOK_URL) {
    bot = new TelegramBot(config.BOT_TOKEN, { webHook: false });
    app.post('/webhook', (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });
    console.log(`🤖 Telegram Bot running in WEBHOOK mode at ${config.WEBHOOK_URL}`);
  } else {
    // Polling starts only after MongoDB is connected (see startup at the bottom)
    bot = new TelegramBot(config.BOT_TOKEN, { polling: { autoStart: false } });
    console.log(`🤖 Telegram Bot running in POLLING mode`);
  }

  bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code, error.message);
  });

  installSafeSending(bot);
} else {
  console.warn('⚠️ BOT_TOKEN is not set in .env! Please configure your Telegram Bot Token.');
  // Create dummy bot instance to avoid crashes if token is missing during initial setup
  bot = {
    on: () => {},
    sendMessage: async () => {},
    onText: () => {}
  };
}

// ------------------------------------------------------------------------------
// Safe sending: the texts use **bold** (not valid in Telegram's legacy Markdown,
// which uses *bold*). Convert it, and if Telegram still can't parse the entities
// (e.g. a username or AI text containing "_" or "*"), resend as plain text
// instead of crashing the handler.
// ------------------------------------------------------------------------------
function toTelegramMarkdown(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\*\*/g, '*')
    // AI answers use "* item" bullet lists, which break Telegram Markdown
    .replace(/^(\s*)\* /gm, '$1• ');
}

// Escape user-provided values (names, usernames) placed inside Markdown text
function escapeMd(value) {
  return String(value ?? '').replace(/([_*`\[])/g, '\\$1');
}

function stripMarkdown(text) {
  return typeof text === 'string' ? text.replace(/\*\*/g, '').replace(/[*`]/g, '') : text;
}

function isParseError(e) {
  return /can't parse entities|can't find end of the entity/i.test((e && e.message) || '');
}

function installSafeSending(botInstance) {
  // method name -> { textArg: index of text argument, optsArg: index of options argument, field }
  const methods = {
    sendMessage: { textArg: 1, optsArg: 2 },
    editMessageText: { textArg: 0, optsArg: 1 },
    sendPhoto: { optsArg: 2, field: 'caption' },
    sendAudio: { optsArg: 2, field: 'caption' },
    sendVoice: { optsArg: 2, field: 'caption' },
    sendDocument: { optsArg: 2, field: 'caption' },
    editMessageCaption: { textArg: 0, optsArg: 1 }
  };

  for (const [name, spec] of Object.entries(methods)) {
    const original = botInstance[name].bind(botInstance);
    botInstance[name] = async (...args) => {
      const opts = args[spec.optsArg];
      const isMd = opts && opts.parse_mode === 'Markdown';
      const getText = () => (spec.field ? opts && opts[spec.field] : args[spec.textArg]);
      const setText = (a, o, v) => { if (spec.field) o[spec.field] = v; else a[spec.textArg] = v; };

      const first = args.slice();
      if (isMd) {
        const o = { ...opts };
        first[spec.optsArg] = o;
        setText(first, o, toTelegramMarkdown(getText()));
      }
      try {
        return await original(...first);
      } catch (e) {
        if (isMd && isParseError(e)) {
          const retry = args.slice();
          const o = { ...opts };
          delete o.parse_mode;
          retry[spec.optsArg] = o;
          setText(retry, o, stripMarkdown(getText()));
          return await original(...retry);
        }
        throw e;
      }
    };
  }
}

// Never let a single failed handler crash the whole bot process
process.on('unhandledRejection', (reason) => {
  const message = (reason && reason.message) || String(reason);
  if (/message is not modified/i.test(message)) return; // harmless
  console.error('Unhandled error:', message);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err && err.stack ? err.stack : err);
  if (err && err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${config.PORT} band — bot allaqachon boshqa oynada ishlayapti. Avval uni to'xtating.`);
    process.exit(1);
  }
});

// Track sent messages for /delete cleanup
async function sendBotMessage(chatId, text, options = {}) {
  try {
    const sent = await bot.sendMessage(chatId, text, options);
    if (sent && sent.message_id) {
      db.trackSentMessage(chatId, sent.message_id);
    }
    return sent;
  } catch (e) {
    console.error('Error sending message:', e.message);
    throw e;
  }
}

// ==============================================================================
// 3. /START AND LANGUAGE SELECTION
// ==============================================================================
bot.onText(/\/start/, async (msgObj) => {
  const chatId = msgObj.chat.id;
  const user = db.getOrCreateUser(msgObj.from);

  // Requirement: First step is language selection
  const text = `🌐 **Tilni tanlang / Select your language / Выберите язык / اختر لغتك:**\n\n` +
    `Iltimos, botdan foydalanish uchun qulay tilni tanlang:\n` +
    `Please select your preferred language:`;

  await sendBotMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: getLanguageKeyboard()
  });
});

// ==============================================================================
// 4. MAIN NAVIGATION & COMMANDS
// ==============================================================================

// /help command
bot.onText(/\/help/, async (msgObj) => {
  const chatId = msgObj.chat.id;
  const user = db.getOrCreateUser(msgObj.from);
  const helpText = msg('help', user.language, user.script);
  await sendBotMessage(chatId, helpText, {
    parse_mode: 'Markdown',
    reply_markup: getMainKeyboard(user.language, user.script)
  });
});

// /status command
bot.onText(/\/status/, async (msgObj) => {
  await handleStatusCommand(msgObj.chat.id, msgObj.from);
});

async function handleStatusCommand(chatId, fromUser) {
  const user = db.getOrCreateUser(fromUser);
  const limits = db.getUserLimits(user);
  const langObj = config.LANGUAGES[user.language] || config.LANGUAGES.uz;
  const targetLangObj = config.LANGUAGES[user.target_lang] || config.LANGUAGES.ar;
  const levelObj = config.LEVELS[user.level] || config.LEVELS.intermediate;

  let premiumStatusText = 'Oddiy (FREE) ⚪';
  let premiumDaysLeft = '0 kun';
  if (user.tier === 'pro') {
    premiumStatusText = 'PRO ⭐️ (Faol)';
  } else if (user.tier === 'promax') {
    premiumStatusText = 'PRO MAX 🌟 (Faol)';
  }

  if (user.premium_expires_at > Date.now()) {
    const diffMs = user.premium_expires_at - Date.now();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    premiumDaysLeft = `${days} kun, ${hours} soat`;
  }

  const scriptLabel = user.language === 'uz' ? (user.script === 'cyrillic' ? 'Кирилл' : 'Lotin') : 'Standart';

  let text = `📊 **FOYDALANUVCHI HISOBI VA STATISTIKASI**\n\n` +
    `👤 **Foydalanuvchi:** §§1§§\n` +
    `🆔 **ID raqam:** \`${user.telegram_id}\`\n` +
    `🌐 **Tanlangan til:** ${langObj.flag} ${langObj.name} (${scriptLabel})\n` +
    `🎯 **Tarjima yo‘nalishi:** ${targetLangObj.flag} ${targetLangObj.name}\n` +
    `📚 **Bilim darajasi:** ${levelObj.label}\n\n` +
    `💎 **Tarif holati:** ${premiumStatusText}\n` +
    `⏳ **Qolgan premium muddati:** ${premiumDaysLeft}\n\n` +
    `📈 **KUNLIK LIMITLAR:**\n` +
    `• 🌐 /translate: **${limits.translateRemaining} / ${limits.translateTotal}** ta qoldi\n` +
    `• 🎙 /voice: **${limits.voiceRemaining} / ${limits.voiceTotal}** ta qoldi\n` +
    `• 🎧 /listening: **${limits.listeningRemaining} / ${limits.listeningTotal}** ta qoldi\n` +
    `• ⚡ Generator krediti: **${limits.generatorCredits}** ta\n\n` +
    `📊 **Umumiy foydalanilgan imkoniyatlar:**\n` +
    `• Matn tarjimalari: ${user.total_translations} marta\n` +
    `• Ovozli tarjimalar: ${user.total_voices} marta\n` +
    `• Listening tahlillari: ${user.total_listenings} marta\n` +
    `• Yaratilgan listeninglar: ${user.total_generators} marta`;

  // Transliterate the template, but keep the real name/username unchanged
  text = toScript(text, user.script).replace(
    '§§1§§',
    `${escapeMd(user.first_name || '')} (${user.username ? '@' + escapeMd(user.username) : toScript('mavjud emas', user.script)})`
  );

  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: toScript('💎 Premium olish', user.script), callback_data: 'open_premium' }],
      [{ text: toScript('⏳ Limitlarni ko‘rish', user.script), callback_data: 'open_limit' }],
      [{ text: toScript('📚 Darajani o‘zgartirish', user.script), callback_data: 'change_level' }]
    ]
  };

  await sendBotMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: inlineKeyboard
  });
}

// /limit command
bot.onText(/\/limit/, async (msgObj) => {
  await handleLimitCommand(msgObj.chat.id, msgObj.from);
});

async function handleLimitCommand(chatId, fromUser) {
  const user = db.getOrCreateUser(fromUser);
  const limits = db.getUserLimits(user);
  const tzInfo = getTimezoneInfo(user.timezone);

  let text = `⏳ **KUNLIK LIMITLAR VA YANGILANISH VAQTI**\n\n` +
    `Quyida hisobingiz bo‘yicha bugungi kun uchun qolgan limitlar ko‘rsatilgan:\n\n` +
    `• 🌐 **Matn tarjimasi (/translate):**\n` +
    `  Qoldi: **${limits.translateRemaining}** ta (Jami: ${limits.translateTotal} ta)\n\n` +
    `• 🎙 **Ovozli xabar tarjimasi (/voice):**\n` +
    `  Qoldi: **${limits.voiceRemaining}** ta (Jami: ${limits.voiceTotal} ta)\n` +
    `  Ruxsat etilgan davomiylik: 2 daqiqagacha\n\n` +
    `• 🎧 **Listening tahlili (/listening):**\n` +
    `  Qoldi: **${limits.listeningRemaining}** ta (Jami: ${limits.listeningTotal} ta)\n\n` +
    `• ⚡ **Generator imkoniyati (/generator):**\n` +
    `  Mavjud kreditlar: **${limits.generatorCredits}** ta\n\n` +
    `🌍 **Sizning hududingiz:** ${user.country}, ${user.region}\n` +
    `🕒 **Mahalliy vaqtingiz:** ${tzInfo.currentTime} (${tzInfo.currentDate})\n` +
    `⏰ **Vaqt mintaqasi:** \`${user.timezone}\`\n\n` +
    `🔄 **Limitlar yangilanishi:** Har kuni mahalliy vaqtingiz bilan soat **00:00** da.\n` +
    `⏳ **Keyingi yangilanishgacha qolgan vaqt:** **${tzInfo.formattedCountdown}**`;

  text = toScript(text, user.script);

  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: toScript('🌍 Hudud / Vaqt mintaqasini o‘zgartirish', user.script), callback_data: 'change_tz_country' }],
      [{ text: toScript('💎 Limitlarni oshirish (Premium)', user.script), callback_data: 'open_premium' }]
    ]
  };

  await sendBotMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: inlineKeyboard
  });
}

// /translate command
bot.onText(/\/translate/, async (msgObj) => {
  await handleTranslateCommand(msgObj.chat.id, msgObj.from);
});

async function handleTranslateCommand(chatId, fromUser) {
  const user = db.getOrCreateUser(fromUser);
  db.setUserState(fromUser.id, 'awaiting_translate_text');

  const srcObj = user.source_lang === 'auto' ? { flag: '🔍', name: 'Avtomatik' } : (config.LANGUAGES[user.source_lang] || { flag: '🌐', name: user.source_lang });
  const tgtObj = config.LANGUAGES[user.target_lang] || config.LANGUAGES.ar;
  const levelObj = config.LEVELS[user.level] || config.LEVELS.intermediate;

  let text = `🌐 **TARJIMA REJIMI**\n\n` +
    `Hozirgi sozlamalar:\n` +
    `• **Manba tili:** ${srcObj.flag} ${srcObj.name}\n` +
    `• **Nishon tili:** ${tgtObj.flag} ${tgtObj.name}\n` +
    `• **Bilim darajasi:** ${levelObj.label}\n\n` +
    `✏️ **Tarjima qilmoqchi bo‘lgan so‘z yoki matningizni yuboring!**\n` +
    `Katta matnlar, kichik jumlalar va so‘zlar to‘liq tushuntirish va misollar bilan tarjima qilinadi.`;

  text = toScript(text, user.script);

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Almashtirish', callback_data: 'swap_translate_langs' }
      ],
      [
        { text: `Manba: ${srcObj.flag}`, callback_data: 'pick_src_lang' },
        { text: `Nishon: ${tgtObj.flag}`, callback_data: 'pick_tgt_lang' }
      ],
      [
        { text: toScript('📚 Darajani tanlash', user.script), callback_data: 'change_level' }
      ]
    ]
  };

  await sendBotMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: inlineKeyboard
  });
}

// /voice command
bot.onText(/\/voice/, async (msgObj) => {
  await handleVoiceCommand(msgObj.chat.id, msgObj.from);
});

async function handleVoiceCommand(chatId, fromUser) {
  const user = db.getOrCreateUser(fromUser);
  db.setUserState(fromUser.id, 'awaiting_voice');

  const tgtObj = config.LANGUAGES[user.target_lang] || config.LANGUAGES.ar;

  let text = `🎙 **OVOZLI XABAR TARJIMASI**\n\n` +
    `Bu funksiya orqali 15 ta tilning istalgan biridagi ovozli xabarni yuborishingiz mumkin.\n\n` +
    `📋 **Talablar va qoidalar:**\n` +
    `• Faqat **2 daqiqagacha** bo‘lgan ovozli xabarlar qabul qilinadi.\n` +
    `• O‘zingizning yoki boshqa odamdan uzatilgan (forward qilingan) ovozli xabarni yuborishingiz mumkin.\n` +
    `• Bot ovozdagi gaplarni aniq aniqlab, matnga aylantiradi va tarjima qiladi.\n\n` +
    `🎯 **Hozirgi tarjima tili:** ${tgtObj.flag} ${tgtObj.name}\n\n` +
    `Endi mikrofon tugmasini bosib, ovozli xabaringizni yuboring:`;

  text = toScript(text, user.script);

  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: `🎯 Tarjima tilini o‘zgartirish (${tgtObj.flag})`, callback_data: 'pick_tgt_lang' }]
    ]
  };

  await sendBotMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: inlineKeyboard
  });
}

// /premium command
bot.onText(/\/premium/, async (msgObj) => {
  await handlePremiumCommand(msgObj.chat.id, msgObj.from);
});

async function handlePremiumCommand(chatId, fromUser) {
  const user = db.getOrCreateUser(fromUser);

  let text = `💎 **ARAB TARJIMA BOT — PREMIUM TARIFLARI**\n\n` +
    `Telegram Stars orqali tezkor va xavfsiz to‘lov qiling va barcha imkoniyatlardan kengaytirilgan limitlar bilan foydalaning!\n\n` +
    `⭐️ **1. PRO TARIFI — 50 Telegram Stars (1 oy):**\n` +
    `• /translate — kuniga **150 ta** tarjima\n` +
    `• /voice — kuniga **60 ta** ovozli tarjima (2 daqiqagacha)\n` +
    `• /listening — kuniga **20 ta** tahlil\n` +
    `• /generator — **20 ta** listening darslik yaratish sovg‘a\n` +
    `• Barcha 13 ta darajadagi tushuntirishlar\n` +
    `• Muddat: 30 kun\n\n` +
    `🌟 **2. PRO MAX TARIFI — 120 Telegram Stars (3 oy):**\n` +
    `• /translate — kuniga **500 ta** tarjima\n` +
    `• /voice — kuniga **200 ta** ovozli tarjima\n` +
    `• /listening — kuniga **60 ta** tahlil\n` +
    `• /generator — **50 ta** listening darslik yaratish sovg‘a\n` +
    `• Tezkor va ustuvor server xizmati\n` +
    `• Muddat: 90 kun\n\n` +
    `⚡ **3. GENERATOR FUNKSIYASINI OCHISH — 250 Stars:**\n` +
    `• /generator imkoniyatini to‘liq ochish va 20 ta kredit\n\n` +
    `Quyidagi tugmalardan birini tanlang:`;

  text = toScript(text, user.script);

  await sendBotMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: getPremiumKeyboard(user.script)
  });
}

// /paysupport command
bot.onText(/\/paysupport/, async (msgObj) => {
  await handlePaySupportCommand(msgObj.chat.id, msgObj.from);
});

async function handlePaySupportCommand(chatId, fromUser) {
  const user = db.getOrCreateUser(fromUser);

  let text = `💖 **MUALLIFNI QO‘LLAB-QUVVATLASH (DONATE)**\n\n` +
    `"Ushbu xayriya ArabTarjimaBot loyihasini rivojlantirish, yangi funksiyalar qo‘shish va xizmat sifatini yaxshilash uchun ishlatiladi."\n\n` +
    `Tavsiya etilgan xayriya miqdori: **1 000 Telegram Stars** ⭐️\n\n` +
    `Agar loyihamizga hissa qo‘shishni istasangiz, quyidagi tugmani bosib tasdiqlang:`;

  text = toScript(text, user.script);

  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '⭐️ 1 000 Stars bilan qo‘llab-quvvatlash', callback_data: 'confirm_paysupport_1000' }],
      [{ text: toScript('❌ Bekor qilish', user.script), callback_data: 'close_menu' }]
    ]
  };

  await sendBotMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: inlineKeyboard
  });
}

// /delete command
bot.onText(/\/delete/, async (msgObj) => {
  const chatId = msgObj.chat.id;
  const user = db.getOrCreateUser(msgObj.from);

  let text = `🗑 **CHAT TARIXINI TOZALASH**\n\n` +
    `⚠️ **Diqqat!**\n` +
    `Bu komanda bot tomonidan yuborilgan so‘nggi xabarlarni tozalaydi.\n\n` +
    `• Bot o‘chirilmaydi.\n` +
    `• Siz botni bloklamaysiz.\n` +
    `• Sizning hisobingiz va ma'lumotlaringiz saqlanib qoladi.\n\n` +
    `Haqiqatan ham chat tarixini tozalamoqchimisiz?`;

  text = toScript(text, user.script);

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: toScript('🗑 Ha, tozalansin', user.script), callback_data: 'confirm_delete_history' },
        { text: toScript('❌ Bekor qilish', user.script), callback_data: 'close_menu' }
      ]
    ]
  };

  await sendBotMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: inlineKeyboard
  });
});

// /listening command
bot.onText(/\/listening/, async (msgObj) => {
  await handleListeningCommand(msgObj.chat.id, msgObj.from);
});

async function handleListeningCommand(chatId, fromUser) {
  const user = db.getOrCreateUser(fromUser);
  const limits = db.getUserLimits(user);

  if (limits.listeningRemaining <= 0) {
    let limitErr = `⚠️ **Listening tahlili limiti tugadi!**\n\n` +
      `Bugungi limitingiz tugagan. Limitlar har kuni mahalliy vaqtingiz bilan 00:00 da yangilanadi.\n` +
      `Yoki /premium orqali PRO tarifiga o‘ting!`;
    return sendBotMessage(chatId, toScript(limitErr, user.script), { parse_mode: 'Markdown' });
  }

  db.setUserState(fromUser.id, 'listening_waiting_material', { audioId: null, photoId: null });

  let text = `🎧 **LISTENING TAHLILI VA SOLISHTIRISH XIZMATI**\n\n` +
    `Bu yangi funksiya orqali siz darslik yoki mashqdagi audio va rasmni bir-biriga moslashtirishingiz mumkin!\n\n` +
    `📥 **Qanday ishlaydi?**\n` +
    `1. Listening uchun **ovozli fayl** (audio yoki voice message) yuboring.\n` +
    `2. Listening uchun **rasm** (kitob varag‘i yoki topshiriq surati) yuboring.\n\n` +
    `🤖 **Bot quyidagilarni bajaradi:**\n` +
    `• Ovozli faylni eshitib, undagi matnni aniqlaydi.\n` +
    `• Rasm ichidagi yozuvlarni (OCR) o‘qiydi.\n` +
    `• Ovoz va rasmdagi matnni bir-biriga moslashtiradi.\n` +
    `• Xatolarni, farqlarni aniqlaydi va tartibli hisobot taqdim etadi.\n\n` +
    `Iltimos, avval **ovozli fayl** yoki **rasm** yuboring:`;

  text = toScript(text, user.script);

  await sendBotMessage(chatId, text, { parse_mode: 'Markdown' });
}

// /generator command
bot.onText(/\/generator/, async (msgObj) => {
  await handleGeneratorCommand(msgObj.chat.id, msgObj.from);
});

async function handleGeneratorCommand(chatId, fromUser) {
  const user = db.getOrCreateUser(fromUser);
  const limits = db.getUserLimits(user);

  if (!limits.generatorAccess && limits.generatorCredits <= 0) {
    let noAccess = `⚡ **LISTENING GENERATOR FUNKSIYASI**\n\n` +
      `Ushbu funksiya orqali 15 ta tilda istalgan hajmda (masalan, 7 varaqli yoki 17 varaqli) professional audio va matnli listening darsliklari yaratishingiz mumkin!\n\n` +
      `💎 **Foydalanish shartlari:**\n` +
      `• Generator funksiyasini ochish — **250 Telegram Stars** (20 ta foydalanish imkoniyati bilan).\n` +
      `• Yoki **PRO / PRO MAX** foydalanuvchilariga avtomatik taqdim etiladi!\n` +
      `• Limit tugaganda 10 Stars evaziga 20 ta yangi limit olish mumkin.\n\n` +
      `Generatorni faollashtirish uchun quyidagi tugmani bosing:`;

    noAccess = toScript(noAccess, user.script);

    return sendBotMessage(chatId, noAccess, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ Generatorni ochish (250 Stars)', callback_data: 'buy_gen_unlock' }],
          [{ text: '⭐️ PRO tarifini olish (50 Stars)', callback_data: 'buy_pro' }]
        ]
      }
    });
  }

  if (limits.generatorCredits <= 0) {
    let noCredits = `⚠️ **Generator limitlaringiz tugagan!**\n\n` +
      `Sizda listening yaratish krediti qolmagan. 10 Telegram Stars evaziga 20 ta kredit sotib olishingiz mumkin:`;
    return sendBotMessage(chatId, toScript(noCredits, user.script), {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 20 ta kredit olish (10 Stars)', callback_data: 'buy_gen_refill' }]
        ]
      }
    });
  }

  // Wizard Step 1: Select language for listening
  let text = `⚡ **LISTENING DARS MATERIALI YARATISH**\n\n` +
    `Qolgan generator kreditlaringiz: **${limits.generatorCredits} ta**\n\n` +
    `1-qadam: Listening qaysi tilda yaratilishi kerak? Tilni tanlang:`;

  text = toScript(text, user.script);

  const langs = Object.values(config.LANGUAGES);
  const rows = [];
  let currentRow = [];

  for (let i = 0; i < langs.length; i++) {
    const l = langs[i];
    currentRow.push({
      text: `${l.flag} ${l.name}`,
      callback_data: `gen_lang_${l.code}`
    });
    if (currentRow.length === 2 || i === langs.length - 1) {
      rows.push(currentRow);
      currentRow = [];
    }
  }

  await sendBotMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: rows }
  });
}

// /admin and /logout commands
bot.onText(/\/admin/, async (msgObj) => {
  const chatId = msgObj.chat.id;
  const userId = msgObj.from.id;

  // Check if session already authenticated
  if (db.verifyAdminSession(userId)) {
    db.clearUserState(userId);
    return showAdminPanel(chatId, userId);
  }

  // Check admin telegram id if configured
  if (config.ADMIN_TELEGRAM_ID && String(userId) !== String(config.ADMIN_TELEGRAM_ID)) {
    return sendBotMessage(chatId, '⛔ Sizda administratorlik huquqi mavjud emas.');
  }

  db.setUserState(userId, 'awaiting_admin_password');
  await sendBotMessage(chatId, '🔐 **Administrator paneliga kirish**\n\nIltimos, maxsus admin parolini kiriting:');
});

bot.onText(/\/logout/, async (msgObj) => {
  const userId = msgObj.from.id;
  db.deleteAdminSession(userId);
  db.clearUserState(userId);
  await sendBotMessage(msgObj.chat.id, '✅ Administrator sessiyasi yakunlandi va paneldan chiqildi.');
});

function formatAdminUserLine(u) {
  const premiumUntil = u.premium_expires_at > 0
    ? ` (gacha: ${new Date(u.premium_expires_at).toISOString().slice(0, 10)})`
    : '';
  return `• ID: \`${u.telegram_id}\` | @${escapeMd(u.username || 'yoq')} | ${escapeMd(u.first_name || '')}\n` +
    `  Tarif: **${u.tier}**${premiumUntil} | Tarjimalar: ${u.total_translations || 0} ta\n\n`;
}

async function handleAdminInput(chatId, adminId, step, text) {
  const backKb = { inline_keyboard: [[{ text: '🔙 Asosiy admin panel', callback_data: 'admin_home' }]] };

  if (step === 'admin_awaiting_search') {
    db.clearUserState(adminId);
    const query = text.replace(/^@/, '');
    const result = db.getAllUsers(1, 10, query);
    if (result.total === 0) {
      return sendBotMessage(chatId, `🔍 "${escapeMd(text)}" bo‘yicha foydalanuvchi topilmadi.`, { parse_mode: 'Markdown', reply_markup: backKb });
    }
    let out = `🔍 **Qidiruv natijalari (${result.total} ta):**\n\n`;
    for (const u of result.users) out += formatAdminUserLine(u);
    return sendBotMessage(chatId, out, { parse_mode: 'Markdown', reply_markup: backKb });
  }

  const parts = text.split(/\s+/);
  const targetId = Number(parts[0]);
  const target = Number.isInteger(targetId) && targetId > 0 ? db.getUser(targetId) : null;
  if (!target) {
    return sendBotMessage(chatId, '❌ Bunday ID raqamli foydalanuvchi topilmadi. Qaytadan ID yuboring yoki /admin bosing.');
  }

  if (step === 'admin_awaiting_add_limits') {
    db.clearUserState(adminId);
    // Negative "used" values give extra remaining uses for today
    db.updateUser(targetId, {
      translate_limit_used: (target.translate_limit_used || 0) - 50,
      voice_limit_used: (target.voice_limit_used || 0) - 50,
      listening_limit_used: (target.listening_limit_used || 0) - 50
    });
    const limits = db.getUserLimits(db.getUser(targetId));
    return sendBotMessage(chatId,
      `✅ \`${targetId}\` foydalanuvchiga bugungi limitlar +50 ga oshirildi.\n` +
      `Qolgan: tarjima ${limits.translateRemaining}, ovozli ${limits.voiceRemaining}, listening ${limits.listeningRemaining}`,
      { parse_mode: 'Markdown', reply_markup: backKb });
  }

  if (step === 'admin_awaiting_reset_limits') {
    db.clearUserState(adminId);
    db.updateUser(targetId, { translate_limit_used: 0, voice_limit_used: 0, listening_limit_used: 0 });
    return sendBotMessage(chatId, `✅ \`${targetId}\` foydalanuvchining kunlik limitlari to‘liq tiklandi.`, { parse_mode: 'Markdown', reply_markup: backKb });
  }

  if (step === 'admin_awaiting_premium') {
    const tier = (parts[1] || '').toLowerCase();
    if (!['free', 'pro', 'promax'].includes(tier)) {
      return sendBotMessage(chatId, '❌ Tarif noto‘g‘ri. Format: `ID pro 30` yoki `ID promax 90` yoki `ID free`', { parse_mode: 'Markdown' });
    }
    db.clearUserState(adminId);
    if (tier === 'free') {
      db.updateUser(targetId, { tier: 'free', premium_expires_at: 0 });
      return sendBotMessage(chatId, `✅ \`${targetId}\` foydalanuvchining premium tarifi bekor qilindi.`, { parse_mode: 'Markdown', reply_markup: backKb });
    }
    const days = parseInt(parts[2], 10) || (tier === 'promax' ? 90 : 30);
    const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
    db.updateUser(targetId, { tier, premium_expires_at: expiresAt });
    try {
      await bot.sendMessage(targetId, `🎁 Administrator sizga ${tier === 'pro' ? 'PRO' : 'PRO MAX'} tarifini ${days} kunga taqdim etdi!`);
    } catch (e) { /* user may have blocked the bot */ }
    return sendBotMessage(chatId,
      `✅ \`${targetId}\` foydalanuvchiga **${tier}** tarifi ${days} kunga berildi (gacha: ${new Date(expiresAt).toISOString().slice(0, 10)}).`,
      { parse_mode: 'Markdown', reply_markup: backKb });
  }
}

// Show Admin Panel
async function showAdminPanel(chatId, userId) {
  const stats = db.getStats();

  let text = `👑 **ADMINISTRATOR BOSHQARUV PANELI**\n\n` +
    `📊 **Bot statistikasi:**\n` +
    `• Jami foydalanuvchilar: **${stats.userCount}** ta\n` +
    `• PRO foydalanuvchilar: **${stats.proCount}** ta\n` +
    `• PRO MAX foydalanuvchilar: **${stats.promaxCount}** ta\n` +
    `• Bepul (FREE) foydalanuvchilar: **${stats.freeCount}** ta\n` +
    `• Jami matn tarjimalari: **${stats.totalTranslations}** marta\n` +
    `• Jami ovozli tarjimalar: **${stats.totalVoices}** marta\n` +
    `• Jami listening tahlillari: **${stats.totalListenings}** marta\n` +
    `• Telegram Stars tushumi: **${stats.totalStars} ⭐️**\n\n` +
    `Boshqaruv amallarini tanlang:`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '👥 Foydalanuvchilar ro‘yxati', callback_data: 'admin_users_1' },
        { text: '🔍 Foydalanuvchi qidirish', callback_data: 'admin_search_user' }
      ],
      [
        { text: '⚡ Limitlarni oshirish (+50)', callback_data: 'admin_add_limits_prompt' },
        { text: '🔄 Limitlarni nolga tushirish', callback_data: 'admin_reset_limits_prompt' }
      ],
      [
        { text: '💎 Premium berish / boshqarish', callback_data: 'admin_premium_prompt' }
      ],
      [
        { text: '🚪 Chiqish (/logout)', callback_data: 'admin_logout_btn' }
      ]
    ]
  };

  await sendBotMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: inlineKeyboard
  });
}

// ==============================================================================
// 5. INLINE BUTTON HANDLERS (CALLBACK QUERIES)
// ==============================================================================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  try {
    const user = db.getOrCreateUser(query.from);

    // Language selection: lang_<code >
    if (data.startsWith('lang_')) {
      const code = data.replace('lang_', '');
      if (code === 'uz') {
        // Requirement 2: If Uzbek, prompt Lotin vs Kirill
        await bot.editMessageText('🇺🇿 **O‘zbek tili uchun yozuv turini tanlang:**', {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: getUzbekScriptKeyboard()
        });
        return bot.answerCallbackQuery(query.id);
      } else {
        db.updateUser(userId, { language: code, script: 'latin' });
        await finishLanguageSelection(chatId, query.from, code, 'latin', query.message.message_id);
        return bot.answerCallbackQuery(query.id);
      }
    }

    // Uzbek script selection
    if (data === 'script_latin' || data === 'script_cyrillic') {
      const script = data === 'script_cyrillic' ? 'cyrillic' : 'latin';
      db.updateUser(userId, { language: 'uz', script: script });
      await finishLanguageSelection(chatId, query.from, 'uz', script, query.message.message_id);
      return bot.answerCallbackQuery(query.id);
    }

    // Level selection
    if (data.startsWith('lvl_')) {
      const levelId = data.replace('lvl_', '');
      db.updateUser(userId, { level: levelId });
      const lvlObj = config.LEVELS[levelId];
      let msgText = `✅ **Bilim darajangiz yangilandi:** ${lvlObj.label}\n\n${lvlObj.desc}`;
      msgText = toScript(msgText, user.script);
      await bot.editMessageText(msgText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown'
      });
      return bot.answerCallbackQuery(query.id, { text: 'Daraja saqlandi!' });
    }

    // Translate language picking
    if (data === 'pick_src_lang') {
      await bot.editMessageText('🌐 **Manba tilini tanlang:**', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: getTranslateLanguageKeyboard('src', user.source_lang, user.script)
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data === 'pick_tgt_lang') {
      await bot.editMessageText('🎯 **Nishon (tarjima qilinadigan) tilni tanlang:**', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: getTranslateLanguageKeyboard('tgt', user.target_lang, user.script)
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith('src_')) {
      const srcCode = data.replace('src_', '');
      db.updateUser(userId, { source_lang: srcCode });
      return handleTranslateCommand(chatId, query.from);
    }

    if (data.startsWith('tgt_')) {
      const tgtCode = data.replace('tgt_', '');
      db.updateUser(userId, { target_lang: tgtCode });
      return handleTranslateCommand(chatId, query.from);
    }

    if (data === 'swap_translate_langs') {
      const currentSrc = user.source_lang === 'auto' ? 'uz' : user.source_lang;
      const currentTgt = user.target_lang;
      db.updateUser(userId, { source_lang: currentTgt, target_lang: currentSrc });
      return handleTranslateCommand(chatId, query.from);
    }

    if (data === 'change_level') {
      await bot.editMessageText('📚 **O‘z bilim darajangizni tanlang:**', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: getLevelKeyboard(user.level, user.script)
      });
      return bot.answerCallbackQuery(query.id);
    }

    // Timezone & Country selection
    if (data === 'change_tz_country') {
      const rows = config.COUNTRIES.map(c => [
        { text: c.name, callback_data: `tz_c_${c.code}` }
      ]);
      await bot.editMessageText('🌍 **Mamlakatingizni tanlang:**', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows }
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith('tz_c_')) {
      const code = data.replace('tz_c_', '');
      const country = findCountry(code);
      const rows = country.regions.slice(0, 10).map(r => [
        { text: r, callback_data: `tz_r_${country.code}_${encodeURIComponent(r)}` }
      ]);
      await bot.editMessageText(`📍 **${country.name} bo‘yicha viloyat/shaharni tanlang:**`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows }
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith('tz_r_')) {
      const parts = data.replace('tz_r_', '').split('_');
      const countryCode = parts[0];
      const region = decodeURIComponent(parts[1]);
      const country = findCountry(countryCode);

      db.updateUser(userId, {
        country: country.name,
        region: region,
        timezone: country.tz
      });

      bot.answerCallbackQuery(query.id, { text: 'Vaqt mintaqasi saqlandi!' });
      return handleLimitCommand(chatId, query.from);
    }

    // Payments via Telegram Stars
    if (data === 'open_premium') {
      return handlePremiumCommand(chatId, query.from);
    }

    if (data === 'open_limit') {
      return handleLimitCommand(chatId, query.from);
    }

    if (data === 'view_status') {
      return handleStatusCommand(chatId, query.from);
    }

    if (data === 'buy_pro') {
      await sendTelegramStarsInvoice(chatId, {
        title: 'PRO Tarifi — 1 Oy',
        description: 'Arab Tarjima Bot: Kuniga 150 ta tarjima, 60 ta ovozli tarjima, 20 ta listening va 20 ta generator darslik.',
        payload: `sub_pro_${userId}_${Date.now()}`,
        amount: config.PRICES.PRO_MONTH
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data === 'buy_promax') {
      await sendTelegramStarsInvoice(chatId, {
        title: 'PRO MAX Tarifi — 3 Oy',
        description: 'Arab Tarjima Bot: Kuniga 500 ta tarjima, 200 ta ovozli tarjima, 60 ta listening va 50 ta generator darslik.',
        payload: `sub_promax_${userId}_${Date.now()}`,
        amount: config.PRICES.PROMAX_3MONTHS
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data === 'buy_gen_unlock') {
      await sendTelegramStarsInvoice(chatId, {
        title: 'Listening Generator Ochish',
        description: 'Arab Tarjima Bot: Listening generator funksiyasini doimiy ochish va 20 ta darslik krediti.',
        payload: `unlock_gen_${userId}_${Date.now()}`,
        amount: config.PRICES.GENERATOR_UNLOCK
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data === 'buy_gen_refill') {
      await sendTelegramStarsInvoice(chatId, {
        title: '20 ta Generator Limiti',
        description: 'Arab Tarjima Bot: Yangi 20 ta listening audio darslik yaratish imkoniyati.',
        payload: `refill_gen_${userId}_${Date.now()}`,
        amount: config.PRICES.GENERATOR_REFILL_10STARS
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data === 'confirm_paysupport_1000') {
      await sendTelegramStarsInvoice(chatId, {
        title: 'ArabTarjimaBot Xayriya',
        description: 'Ushbu xayriya ArabTarjimaBot loyihasini rivojlantirish va yangi funksiyalar qo‘shish uchun ishlatiladi.',
        payload: `paysupport_${userId}_${Date.now()}`,
        amount: config.PRICES.PAY_SUPPORT_RECOMMENDED
      });
      return bot.answerCallbackQuery(query.id);
    }

    // Delete chat history confirmation
    if (data === 'confirm_delete_history') {
      const messages = db.getRecentSentMessages(chatId, 50);
      let deletedCount = 0;
      for (const m of messages) {
        try {
          await bot.deleteMessage(chatId, m.message_id);
          deletedCount++;
        } catch (e) {
          // Message might be too old or already deleted
        }
      }
      db.clearSentMessages(chatId);
      await sendBotMessage(chatId, `🧹 Chat tozalandi! ${deletedCount} ta xabar o‘chirildi.`);
      return bot.answerCallbackQuery(query.id, { text: 'Tozalandi' });
    }

    // Generator wizard steps
    if (data.startsWith('gen_lang_')) {
      const langCode = data.replace('gen_lang_', '');
      db.setUserState(userId, 'gen_step_level', { lang: langCode });

      const levels = Object.values(config.LEVELS);
      const rows = levels.map(l => [{ text: l.label, callback_data: `gen_lvl_${l.id}` }]);

      await bot.editMessageText('📚 **2-qadam: Tinglash mashqining darajasini tanlang:**', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows }
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith('gen_lvl_')) {
      const lvlId = data.replace('gen_lvl_', '');
      const state = db.getUserState(userId);
      const stateData = state?.data || {};
      stateData.level = lvlId;
      db.setUserState(userId, 'gen_step_topic', stateData);

      const topicRows = [
        [{ text: '🗣 Kundalik suhbat va tanishuv', callback_data: 'gen_top_muloqot' }],
        [{ text: '✈️ Sayohat va Aeroportda', callback_data: 'gen_top_sayohat' }],
        [{ text: '🛒 Arab bozorida savdolashish', callback_data: 'gen_top_bozor' }],
        [{ text: '🎓 Universitet va Ta\'lim', callback_data: 'gen_top_talim' }],
        [{ text: '🕌 Islomiy madaniyat va tarix', callback_data: 'gen_top_islom' }],
        [{ text: '✍️ Boshqa erkin mavzu yozish', callback_data: 'gen_top_custom' }]
      ];

      await bot.editMessageText('🎯 **3-qadam: Mavzuni tanlang:**', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: topicRows }
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith('gen_top_')) {
      const topicKey = data.replace('gen_top_', '');
      const state = db.getUserState(userId);
      const stateData = state?.data || {};

      if (topicKey === 'custom') {
        db.setUserState(userId, 'gen_awaiting_custom_topic', stateData);
        await bot.editMessageText('✏️ **Listening darsligi uchun o‘zingiz xohlagan mavzuni yozib yuboring:**', {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        });
        return bot.answerCallbackQuery(query.id);
      }

      const topicTitles = {
        muloqot: 'Kundalik suhbat va tanishuv',
        sayohat: 'Sayohat va Aeroportda muloqot',
        bozor: 'Arab bozorida xarid va savdolashish',
        talim: 'Universitet va talabalik hayoti',
        islom: 'Arab tili, madaniyati va tarixi'
      };

      stateData.topic = topicTitles[topicKey] || 'Kundalik muloqot';
      db.setUserState(userId, 'gen_step_pages', stateData);

      // Requirement 13: Volume selection (e.g. 7 varaq, 17 varaq, custom)
      const pageRows = [
        [{ text: '📄 3 varaqli listening (Qisqa)', callback_data: 'gen_pages_3' }],
        [{ text: '📑 7 varaqli listening (O‘rtacha)', callback_data: 'gen_pages_7' }],
        [{ text: '📚 17 varaqli listening (Katta hajm)', callback_data: 'gen_pages_17' }]
      ];

      await bot.editMessageText('📏 **4-qadam: Listening hajmini tanlang:**', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: pageRows }
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith('gen_pages_')) {
      const pages = data.replace('gen_pages_', '');
      const state = db.getUserState(userId);
      const stateData = state?.data || {};
      stateData.pages = pages;

      bot.answerCallbackQuery(query.id, { text: 'Yaratish boshlandi...' });
      await executeListeningGeneration(chatId, user, stateData, query.message.message_id);
      return;
    }

    // Admin panel actions
    if (data.startsWith('admin_users_')) {
      if (!db.verifyAdminSession(userId)) return;
      const page = parseInt(data.replace('admin_users_', ''), 10) || 1;
      const result = db.getAllUsers(page, 5);

      let text = `👥 **Foydalanuvchilar ro‘yxati (Sahifa ${result.page}/${result.totalPages || 1}):**\n\n`;
      for (const u of result.users) {
        text += formatAdminUserLine(u);
      }

      const navRows = [];
      const row = [];
      if (result.page > 1) {
        row.push({ text: '⬅️ Oldingi', callback_data: `admin_users_${result.page - 1}` });
      }
      if (result.page < result.totalPages) {
        row.push({ text: 'Keyingi ➡️', callback_data: `admin_users_${result.page + 1}` });
      }
      if (row.length > 0) navRows.push(row);
      navRows.push([{ text: '🔙 Asosiy admin panel', callback_data: 'admin_home' }]);

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: navRows }
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data === 'admin_home') {
      if (!db.verifyAdminSession(userId)) return bot.answerCallbackQuery(query.id, { text: 'Avval /admin orqali kiring' });
      await bot.answerCallbackQuery(query.id);
      return showAdminPanel(chatId, userId);
    }

    // Admin actions that need a text input from the admin
    const adminPrompts = {
      admin_search_user: ['admin_awaiting_search', '🔍 Qidirish uchun foydalanuvchi ID, @username yoki ismini yuboring:'],
      admin_add_limits_prompt: ['admin_awaiting_add_limits', '⚡ Kunlik limitlarini +50 ga oshirish uchun foydalanuvchi ID raqamini yuboring:'],
      admin_reset_limits_prompt: ['admin_awaiting_reset_limits', '🔄 Limitlarini nolga tushirish (to‘liq tiklash) uchun foydalanuvchi ID raqamini yuboring:'],
      admin_premium_prompt: ['admin_awaiting_premium', '💎 Format: `ID tarif kun`\n\nMisollar:\n`123456789 pro 30`\n`123456789 promax 90`\n`123456789 free` — premiumni bekor qilish']
    };
    if (adminPrompts[data]) {
      if (!db.verifyAdminSession(userId)) return bot.answerCallbackQuery(query.id, { text: 'Avval /admin orqali kiring' });
      const [step, prompt] = adminPrompts[data];
      db.setUserState(userId, step);
      await sendBotMessage(chatId, prompt + '\n\n❌ Bekor qilish: /logout yoki /admin', { parse_mode: 'Markdown' });
      return bot.answerCallbackQuery(query.id);
    }

    // "🔙 Ortga" from the level menu -> back to language/settings selection
    if (data === 'settings_menu') {
      await bot.editMessageText('🌐 **Til va yozuv turini tanlang:**', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: getLanguageKeyboard()
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data === 'admin_logout_btn') {
      db.deleteAdminSession(userId);
      await bot.editMessageText('✅ Administrator paneldan chiqildi.', {
        chat_id: chatId,
        message_id: query.message.message_id
      });
      return bot.answerCallbackQuery(query.id);
    }

    if (data === 'close_menu') {
      await bot.deleteMessage(chatId, query.message.message_id);
      return bot.answerCallbackQuery(query.id);
    }

    bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('Callback error:', err.message);
    bot.answerCallbackQuery(query.id, { text: 'Xatolik yuz berdi' });
  }
});

// Finish language selection and show welcome
async function finishLanguageSelection(chatId, fromUser, lang, script, editMsgId) {
  const user = db.getOrCreateUser(fromUser);
  db.updateUser(fromUser.id, { language: lang, script: script });

  const welcomeText = msg('welcome', lang, script);
  const mainKeyboard = getMainKeyboard(lang, script);

  if (editMsgId) {
    try {
      await bot.deleteMessage(chatId, editMsgId);
    } catch (e) {}
  }

  await sendBotMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: mainKeyboard
  });
}

// Send real Telegram Stars invoice
async function sendTelegramStarsInvoice(chatId, { title, description, payload, amount }) {
  try {
    // Official Telegram Stars API: provider_token is empty string, currency is 'XTR'
    await bot.sendInvoice(
      chatId,
      title,
      description,
      payload,
      '', // provider_token is empty for Telegram Stars
      'XTR', // Telegram Stars currency
      [{ label: title, amount: parseInt(amount, 10) }]
    );
  } catch (err) {
    console.error('Invoice error:', err.message);
    await sendBotMessage(chatId, `⚠️ To‘lov hisobini chiqarishda xatolik: ${err.message}`);
  }
}

// Handle pre_checkout_query (Mandatory for Telegram payments)
bot.on('pre_checkout_query', async (query) => {
  try {
    await bot.answerPreCheckoutQuery(query.id, true);
  } catch (e) {
    console.error('Pre-checkout error:', e.message);
  }
});

// Handle successful_payment
bot.on('successful_payment', async (msgObj) => {
  const chatId = msgObj.chat.id;
  const userId = msgObj.from.id;
  const payment = msgObj.successful_payment;
  const payload = payment.invoice_payload;
  const starsAmount = payment.total_amount;
  const chargeId = payment.telegram_payment_charge_id;
  const providerChargeId = payment.provider_payment_charge_id || '';

  const user = db.getOrCreateUser(msgObj.from);

  // 1. Support donation
  if (payload.startsWith('paysupport_')) {
    db.logPayment(userId, 'support_donation', starsAmount, chargeId, providerChargeId);
    const thankYou = `Bizni qo‘llab-quvvatlaganingiz uchun sizga katta rahmat! Inshaalloh, dekabr oyida loyihamiz uchun yangi sayt ochiladi. Sizni ham ushbu loyihaning hamkori sifatida e'tirof etamiz. Biz bilan ekaningizdan xursandmiz!`;
    return sendBotMessage(chatId, toScript(thankYou, user.script));
  }

  // 2. PRO Subscription (1 month / 30 days)
  if (payload.startsWith('sub_pro_')) {
    const currentExpiry = user.premium_expires_at > Date.now() ? user.premium_expires_at : Date.now();
    const newExpiry = currentExpiry + (30 * 24 * 60 * 60 * 1000);
    db.updateUser(userId, {
      tier: 'pro',
      premium_expires_at: newExpiry,
      generator_access: 1,
      generator_credits: (user.generator_credits || 0) + 20
    });
    db.logPayment(userId, 'pro_month', starsAmount, chargeId, providerChargeId);

    let successMsg = `🎉 **PRO TARIFI MUVAFFAQIYATLI FAOLLASHTIRILDI!**\n\n` +
      `Siz 1 oyga PRO tarifiga ega bo‘ldingiz.\n` +
      `• Kunlik tarjima limiti: 150 ta\n` +
      `• Kunlik ovozli tarjima: 60 ta\n` +
      `• Kunlik listening tahlili: 20 ta\n` +
      `• Sovg‘a: 20 ta Generator darslik krediti qo‘shildi!\n\n` +
      `Xizmatingizdan xursandmiz!`;
    return sendBotMessage(chatId, toScript(successMsg, user.script), { parse_mode: 'Markdown' });
  }

  // 3. PRO MAX Subscription (3 months / 90 days)
  if (payload.startsWith('sub_promax_')) {
    const currentExpiry = user.premium_expires_at > Date.now() ? user.premium_expires_at : Date.now();
    const newExpiry = currentExpiry + (90 * 24 * 60 * 60 * 1000);
    db.updateUser(userId, {
      tier: 'promax',
      premium_expires_at: newExpiry,
      generator_access: 1,
      generator_credits: (user.generator_credits || 0) + 50
    });
    db.logPayment(userId, 'promax_3months', starsAmount, chargeId, providerChargeId);

    let successMsg = `🌟 **PRO MAX TARIFI MUVAFFAQIYATLI FAOLLASHTIRILDI!**\n\n` +
      `Siz 3 oyga (90 kunga) PRO MAX tarifiga ega bo‘ldingiz!\n` +
      `• Kunlik tarjima limiti: 500 ta\n` +
      `• Kunlik ovozli tarjima: 200 ta\n` +
      `• Kunlik listening tahlili: 60 ta\n` +
      `• Sovg‘a: 50 ta Generator darslik krediti qo‘shildi!\n\n` +
      `Katta rahmat!`;
    return sendBotMessage(chatId, toScript(successMsg, user.script), { parse_mode: 'Markdown' });
  }

  // 4. Generator unlock
  if (payload.startsWith('unlock_gen_')) {
    db.updateUser(userId, {
      generator_access: 1,
      generator_credits: (user.generator_credits || 0) + 20
    });
    db.logPayment(userId, 'generator_unlock', starsAmount, chargeId, providerChargeId);
    let successMsg = `⚡ **LISTENING GENERATOR FAOLLASHTIRILDI!**\n\n` +
      `Sizga 20 ta listening yaratish krediti taqdim etildi. /generator komandasi orqali boshlashingiz mumkin!`;
    return sendBotMessage(chatId, toScript(successMsg, user.script), { parse_mode: 'Markdown' });
  }

  // 5. Generator refill
  if (payload.startsWith('refill_gen_')) {
    db.updateUser(userId, {
      generator_credits: (user.generator_credits || 0) + 20
    });
    db.logPayment(userId, 'generator_refill', starsAmount, chargeId, providerChargeId);
    let successMsg = `🔄 **20 TA GENERATOR KREDITI QO‘SHILDI!**\n\n` +
      `Hozirgi mavjud kreditlaringiz: ${(user.generator_credits || 0) + 20} ta.`;
    return sendBotMessage(chatId, toScript(successMsg, user.script), { parse_mode: 'Markdown' });
  }
});

// ==============================================================================
// 6. LISTENING GENERATOR EXECUTION
// ==============================================================================
async function executeListeningGeneration(chatId, user, { lang, level, topic, pages }, editMsgId) {
  try {
    if (editMsgId) {
      await bot.editMessageText('⏳ **Listening darsligi va ovozli fayli tayyorlanmoqda...**\n(Bu 15-30 soniya vaqt olishi mumkin, iltimos kuting)', {
        chat_id: chatId,
        message_id: editMsgId,
        parse_mode: 'Markdown'
      });
    }

    // Call AI to generate text + dialogue
    const result = await generateListeningMaterial({
      language: lang,
      level: level,
      topic: topic,
      pages: pages,
      script: user.script
    });

    // Deduct 1 generator credit
    db.consumeLimit(user.telegram_id, 'generator');

    // Generate natural neural audio via Edge TTS
    let audioPath = null;
    try {
      audioPath = await generateSpeechAudio(result.audioScript, lang);
    } catch (ttsErr) {
      console.warn('TTS generation failed:', ttsErr.message);
    }

    // Send the generated curriculum text
    const textHeader = `🎧 **LISTENING DARSLIK MATERIALLARI**\n` +
      `🌐 Til: ${config.LANGUAGES[lang]?.name || lang}\n` +
      `📚 Daraja: ${config.LEVELS[level]?.label || level}\n` +
      `🎯 Mavzu: ${topic}\n` +
      `📏 Hajm: ${pages} varaqli listening\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n`;

    const fullContent = textHeader + result.fullText;

    // If text exceeds Telegram 4096 char limit, send in chunks or as file
    if (fullContent.length > 4000) {
      const tempTxtPath = path.join(__dirname, `data/listening_${Date.now()}.txt`);
      fs.writeFileSync(tempTxtPath, fullContent, 'utf8');
      await bot.sendDocument(chatId, tempTxtPath, {
        caption: toScript(`📑 ${pages} varaqli listening darslik to‘liq matni va savollari`, user.script)
      });
      fs.unlinkSync(tempTxtPath);
    } else {
      await sendBotMessage(chatId, toScript(fullContent, user.script), { parse_mode: 'Markdown' });
    }

    // Send the audio file
    if (audioPath && fs.existsSync(audioPath)) {
      await bot.sendVoice(chatId, audioPath, {
        caption: toScript(`🎙 Tinglash mashqi audio fayli (${config.LANGUAGES[lang]?.name || lang})`, user.script)
      });
      cleanupAudioFile(audioPath);
    }

    db.clearUserState(user.telegram_id);
  } catch (err) {
    console.error('Error generating listening:', err.message);
    await sendBotMessage(chatId, `❌ Xatolik yuz berdi: ${err.message}`);
    db.clearUserState(user.telegram_id);
  }
}

// ==============================================================================
// 7. MESSAGE HANDLERS: TEXT, VOICE, AUDIO, PHOTOS, GROUPS
// ==============================================================================
bot.on('message', async (msgObj) => {
  // Ignore all /commands: they are handled by bot.onText handlers above
  // (previously /status, /limit, ... were also sent to the AI translator)
  if (msgObj.text && msgObj.text.startsWith('/')) {
    return;
  }

  const chatId = msgObj.chat.id;
  const isGroup = msgObj.chat.type === 'group' || msgObj.chat.type === 'supergroup';
  const fromUser = msgObj.from;
  if (!fromUser) return;

  const user = db.getOrCreateUser(fromUser);
  const state = db.getUserState(fromUser.id);

  // ----------------------------------------------------------------------------
  // GROUP CHAT FILTERING (Requirement 7: Responds ONLY when directly mentioned)
  // ----------------------------------------------------------------------------
  if (isGroup) {
    let botUsername = '';
    try {
      const me = await bot.getMe();
      botUsername = me.username;
    } catch (e) {}

    const isMentioned = (msgObj.text && botUsername && msgObj.text.includes(`@${botUsername}`)) ||
      (msgObj.reply_to_message && msgObj.reply_to_message.from && msgObj.reply_to_message.from.username === botUsername);

    if (!isMentioned) {
      // Do not process messages in group if bot is not called!
      return;
    }

    // Extract query: remove @BotUsername
    let queryText = (msgObj.text || '').replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
    // Remove keywords like "tarjima qil", "shu matnni inglizchaga o'gir"
    queryText = queryText.replace(/^(tarjima qil|shu matnni|o‘gir|ogir)\s*/gi, '').trim();

    if (!queryText && msgObj.reply_to_message && msgObj.reply_to_message.text) {
      queryText = msgObj.reply_to_message.text;
    }

    if (!queryText) {
      return sendBotMessage(chatId, 'Men guruhda faqat chaqirilganda tarjima qilaman. Iltimos, matn yuboring: `@ArabTarjimaBot tarjima qil <matn>`', {
        reply_to_message_id: msgObj.message_id
      });
    }

    // Process translation for group mention
    return processTextTranslation(chatId, user, queryText, msgObj.message_id);
  }

  // ----------------------------------------------------------------------------
  // ADMIN PASSWORD CHECK
  // ----------------------------------------------------------------------------
  if (state?.currentStep === 'awaiting_admin_password') {
    const enteredPassword = (msgObj.text || '').trim();
    if (config.ADMIN_PASSWORD && enteredPassword === config.ADMIN_PASSWORD) {
      db.createAdminSession(fromUser.id, 120);
      db.clearUserState(fromUser.id);
      await sendBotMessage(chatId, '✅ Administrator paroli to‘g‘ri! Panel ochilmoqda...');
      return showAdminPanel(chatId, fromUser.id);
    } else {
      db.clearUserState(fromUser.id);
      return sendBotMessage(chatId, '❌ Parol noto‘g‘ri! Administrator paneliga kirish rad etildi.');
    }
  }

  // ----------------------------------------------------------------------------
  // ADMIN PANEL TEXT INPUTS (search / limits / premium)
  // ----------------------------------------------------------------------------
  if (state?.currentStep && state.currentStep.startsWith('admin_awaiting_')) {
    if (!db.verifyAdminSession(fromUser.id)) {
      db.clearUserState(fromUser.id);
      return sendBotMessage(chatId, '⛔ Admin sessiyasi tugagan. Qayta /admin orqali kiring.');
    }
    return handleAdminInput(chatId, fromUser.id, state.currentStep, (msgObj.text || '').trim());
  }

  // Custom topic for generator
  if (state?.currentStep === 'gen_awaiting_custom_topic') {
    const topicText = (msgObj.text || '').trim();
    const stateData = state?.data || {};
    stateData.topic = topicText || 'Erkin mavzu';
    stateData.pages = '7'; // default
    db.setUserState(fromUser.id, 'gen_running', stateData);
    await sendBotMessage(chatId, `🎯 Tanlangan mavzu: "${stateData.topic}". Listening yaratilmoqda...`);
    return executeListeningGeneration(chatId, user, stateData);
  }

  // ----------------------------------------------------------------------------
  // LISTENING MODE: AUDIO + IMAGE PAIR
  // ----------------------------------------------------------------------------
  if (state?.currentStep === 'listening_waiting_material') {
    const stateData = state?.data || {};

    // If audio/voice received
    if (msgObj.voice || msgObj.audio) {
      const fileId = msgObj.voice ? msgObj.voice.file_id : msgObj.audio.file_id;
      stateData.audioId = fileId;
      stateData.audioMime = msgObj.voice ? 'audio/ogg' : (msgObj.audio.mime_type || 'audio/mp3');
      db.setUserState(fromUser.id, 'listening_waiting_material', stateData);

      if (!stateData.photoId) {
        return sendBotMessage(chatId, toScript('✅ Ovozli fayl qabul qilindi! Endi unga mos **rasmni** (kitob varag‘i yoki topshiriq suratini) yuboring:', user.script));
      }
    }

    // If photo received
    if (msgObj.photo && msgObj.photo.length > 0) {
      const largestPhoto = msgObj.photo[msgObj.photo.length - 1];
      stateData.photoId = largestPhoto.file_id;
      stateData.photoMime = 'image/jpeg';
      db.setUserState(fromUser.id, 'listening_waiting_material', stateData);

      if (!stateData.audioId) {
        return sendBotMessage(chatId, toScript('✅ Rasm qabul qilindi! Endi unga mos **ovozli faylni** (audio yoki voice message) yuboring:', user.script));
      }
    }

    // Both audio and photo are present: run analysis!
    if (stateData.audioId && stateData.photoId) {
      await sendBotMessage(chatId, toScript('🔍 Audio va rasm qabul qilindi! Tahlil qilish va solishtirish boshlanmoqda...', user.script));

      try {
        const audioLink = await bot.getFileLink(stateData.audioId);
        const photoLink = await bot.getFileLink(stateData.photoId);

        const [audioRes, photoRes] = await Promise.all([
          axios.get(audioLink, { responseType: 'arraybuffer' }),
          axios.get(photoLink, { responseType: 'arraybuffer' })
        ]);

        const analysis = await analyzeListeningTask({
          audioBuffer: Buffer.from(audioRes.data),
          audioMime: stateData.audioMime || 'audio/ogg',
          imageBuffer: Buffer.from(photoRes.data),
          imageMime: stateData.photoMime || 'image/jpeg',
          userLang: user.language,
          script: user.script
        });

        db.consumeLimit(fromUser.id, 'listening');
        db.logTranslation(fromUser.id, 'listening', 'audio+image', user.language, 0);
        db.clearUserState(fromUser.id);

        return sendBotMessage(chatId, analysis.text, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error('Error analyzing listening task:', err.message);
        db.clearUserState(fromUser.id);
        return sendBotMessage(chatId, `❌ Tahlil jarayonida xatolik: ${err.message}`);
      }
    }
  }

  // ----------------------------------------------------------------------------
  // VOICE MESSAGE TRANSLATION (/voice or direct voice)
  // ----------------------------------------------------------------------------
  if (msgObj.voice || msgObj.audio) {
    const voiceDuration = msgObj.voice ? msgObj.voice.duration : (msgObj.audio ? msgObj.audio.duration : 0);

    // Requirement 4: Max 2 minutes (120s) limit
    if (voiceDuration > 120) {
      let durationErr = `⚠️ **Ovozli xabar hajmi katta!**\n\n` +
        `Bot faqat **2 daqiqagacha (120 soniya)** bo‘lgan ovozli xabarlarni qabul qiladi.\n` +
        `Yuborilgan audio davomiyligi: **${voiceDuration} soniya**.\n` +
        `Iltimos, 2 daqiqadan qisqa ovozli xabar yuboring.`;
      return sendBotMessage(chatId, toScript(durationErr, user.script), { parse_mode: 'Markdown' });
    }

    // Check daily voice limit
    const limits = db.getUserLimits(user);
    if (limits.voiceRemaining <= 0) {
      let limitErr = `⚠️ **Ovozli tarjima limitingiz tugadi!**\n\n` +
        `Kunlik limitingiz: ${limits.voiceTotal} ta. Yangilanish har kuni 00:00 da.\n` +
        `Yoki /premium orqali PRO tarifiga o‘ting!`;
      return sendBotMessage(chatId, toScript(limitErr, user.script), { parse_mode: 'Markdown' });
    }

    const waitMsg = await sendBotMessage(chatId, toScript('🎙 Ovozli xabar eshitilmoqda va tarjima qilinmoqda...', user.script));

    try {
      const fileId = msgObj.voice ? msgObj.voice.file_id : msgObj.audio.file_id;
      const fileLink = await bot.getFileLink(fileId);
      const audioRes = await axios.get(fileLink, { responseType: 'arraybuffer' });

      const result = await transcribeAndTranslateVoice({
        audioBuffer: Buffer.from(audioRes.data),
        mimeType: msgObj.voice ? 'audio/ogg' : (msgObj.audio?.mime_type || 'audio/mp3'),
        targetLang: user.target_lang,
        level: user.level,
        script: user.script
      });

      db.consumeLimit(fromUser.id, 'voice');
      db.logTranslation(fromUser.id, 'voice', 'voice', user.target_lang, 0);

      await bot.deleteMessage(chatId, waitMsg.message_id);
      return sendBotMessage(chatId, result.text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Voice translation error:', err.message);
      await bot.deleteMessage(chatId, waitMsg.message_id);
      return sendBotMessage(chatId, `❌ Ovozli tarjimada xatolik yuz berdi: ${err.message}`);
    }
  }

  // ----------------------------------------------------------------------------
  // MAIN KEYBOARD BUTTON CLICKS
  // ----------------------------------------------------------------------------
  if (msgObj.text) {
    const text = msgObj.text.trim();

    if (text.includes('Tarjima') || text.includes('Таржима')) {
      return handleTranslateCommand(chatId, fromUser);
    }
    if (text.includes('Ovozli tarjima') || text.includes('Овозли таржима')) {
      return handleVoiceCommand(chatId, fromUser);
    }
    if (text.includes('Listening') || text.includes('Листенинг')) {
      return handleListeningCommand(chatId, fromUser);
    }
    if (text.includes('Generator') || text.includes('Генератор')) {
      return handleGeneratorCommand(chatId, fromUser);
    }
    if (text.includes('Status') || text.includes('Статус')) {
      return handleStatusCommand(chatId, fromUser);
    }
    if (text.includes('Premium') || text.includes('Премиум')) {
      return handlePremiumCommand(chatId, fromUser);
    }
    if (text.includes('Limitlar') || text.includes('Лимитлар')) {
      return handleLimitCommand(chatId, fromUser);
    }
    if (text.includes('Sozlamalar') || text.includes('Созламалар') || text.includes('Til')) {
      return sendBotMessage(chatId, '🌐 **Til va yozuv turini tanlang:**', {
        reply_markup: getLanguageKeyboard()
      });
    }
    if (text.includes('Yordam') || text.includes('Ёрдам')) {
      const helpText = msg('help', user.language, user.script);
      return sendBotMessage(chatId, helpText, { parse_mode: 'Markdown' });
    }
    if (text.includes('Qo‘llab-quvvatlash') || text.includes('Қўллаб-қувватлаш')) {
      return handlePaySupportCommand(chatId, fromUser);
    }

    // Default: Text Translation
    return processTextTranslation(chatId, user, text, msgObj.message_id);
  }
});

// Process text translation
async function processTextTranslation(chatId, user, text, replyToId = null) {
  const limits = db.getUserLimits(user);
  if (limits.translateRemaining <= 0) {
    let limitErr = `⚠️ **Kunlik tarjima limitingiz tugadi!**\n\n` +
      `Bugungi limit: ${limits.translateTotal} ta.\n` +
      `Limitlar har kuni mahalliy vaqtingiz bilan 00:00 da yangilanadi.\n` +
      `Yoki /premium orqali PRO tarifiga o‘ting!`;
    return sendBotMessage(chatId, toScript(limitErr, user.script), { parse_mode: 'Markdown' });
  }

  const waitMsg = await sendBotMessage(chatId, toScript('⏳ Tarjima qilinmoqda...', user.script));

  try {
    const result = await translateText({
      text: text,
      sourceLang: user.source_lang,
      targetLang: user.target_lang,
      level: user.level,
      script: user.script
    });

    db.consumeLimit(user.telegram_id, 'translate');
    db.logTranslation(user.telegram_id, 'text', user.source_lang, user.target_lang, text.length);

    await bot.deleteMessage(chatId, waitMsg.message_id);

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Tillar almashish', callback_data: 'swap_translate_langs' },
            { text: '🎯 Boshqa til', callback_data: 'pick_tgt_lang' }
          ]
        ]
      }
    };
    if (replyToId) options.reply_to_message_id = replyToId;

    await sendBotMessage(chatId, result.text, options);
  } catch (err) {
    console.error('Translation error:', err.message);
    await bot.deleteMessage(chatId, waitMsg.message_id);
    await sendBotMessage(chatId, `❌ Tarjimada xatolik yuz berdi: ${err.message}`);
  }
}

// ==============================================================================
// 8. BACKGROUND LIMIT RESET WATCHER (Runs every 60 seconds)
// ==============================================================================
setInterval(() => {
  try {
    // Scan all users and trigger midnight reset check
    db.resetAllDailyLimits();
  } catch (e) {
    // ignore background errors
  }
}, 60000);

// ==============================================================================
// 9. STARTUP: connect MongoDB first, then start receiving Telegram updates
// ==============================================================================
db.init()
  .then(async () => {
    if (config.BOT_TOKEN) {
      if (config.BOT_MODE === 'webhook' && config.WEBHOOK_URL) {
        await bot.setWebHook(`${config.WEBHOOK_URL}/webhook`);
      } else {
        await bot.startPolling();
      }
    }
    console.log('✅ Arab Tarjima Bot initialized successfully.');
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error('   Check MONGODB_URI in .env and make sure MongoDB is running.');
    process.exit(1);
  });

async function shutdown() {
  try {
    if (bot && bot.isPolling && bot.isPolling()) await bot.stopPolling();
    await db.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, bot };
