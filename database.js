/**
 * MongoDB storage layer.
 *
 * All data is persisted in MongoDB. To keep the existing synchronous API used
 * throughout app.js, documents are loaded into an in-memory cache on startup
 * (`await db.init()`), reads are served from the cache, and every mutation is
 * written through to MongoDB immediately (asynchronously).
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const config = require('./config');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'arab_tarjima_bot';

let client = null;
let mdb = null;
let initialized = false;

// In-memory caches
const users = new Map();          // telegram_id -> user doc
const adminSessions = new Map();  // telegram_id -> { telegram_id, authenticated_at, expires_at }
const userStates = new Map();     // telegram_id -> { telegram_id, current_step, data, updated_at }
const sentMessages = new Map();   // chat_id -> [message_id, ...] (newest last)
const counters = { translations: 0, voices: 0, listenings: 0, stars: 0 };

const SENT_MESSAGES_KEEP = 200;

function col(name) {
  return mdb.collection(name);
}

// Fire-and-forget persistence with error logging
function persist(promiseFactory) {
  if (!mdb) return;
  Promise.resolve()
    .then(promiseFactory)
    .catch(e => console.error('MongoDB write error:', e.message));
}

function stripId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

/**
 * One-time migration from the old SQLite database (data/arab_tarjima_bot.db)
 */
async function migrateFromSqlite() {
  const sqlitePath = path.join(__dirname, 'data', 'arab_tarjima_bot.db');
  if (!fs.existsSync(sqlitePath)) return;
  const migrated = await col('meta').findOne({ _id: 'sqlite_migrated' });
  if (migrated) return;

  let sdb;
  try {
    const { DatabaseSync } = require('node:sqlite');
    sdb = new DatabaseSync(sqlitePath, { readOnly: true });
  } catch (e) {
    console.warn('SQLite migration skipped:', e.message);
    return;
  }

  const safeAll = (sql) => {
    try { return sdb.prepare(sql).all(); } catch (e) { return []; }
  };

  const oldUsers = safeAll('SELECT * FROM users');
  const oldLogs = safeAll('SELECT * FROM translations_log');
  const oldPayments = safeAll('SELECT * FROM payments');
  const oldStates = safeAll('SELECT * FROM user_states');

  const plain = (row) => JSON.parse(JSON.stringify(row, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));

  if (oldUsers.length) {
    await col('users').bulkWrite(oldUsers.map(u => {
      const doc = plain(u);
      return { updateOne: { filter: { telegram_id: doc.telegram_id }, update: { $setOnInsert: doc }, upsert: true } };
    }));
  }
  if (oldLogs.length) {
    await col('translations_log').insertMany(oldLogs.map(r => { const d = plain(r); delete d.id; return d; }));
  }
  if (oldPayments.length) {
    await col('payments').insertMany(oldPayments.map(r => { const d = plain(r); delete d.id; return d; }));
  }
  if (oldStates.length) {
    await col('user_states').bulkWrite(oldStates.map(r => {
      const d = plain(r);
      let data = {};
      try { data = d.data_json ? JSON.parse(d.data_json) : {}; } catch (e) { /* ignore */ }
      return {
        updateOne: {
          filter: { telegram_id: d.telegram_id },
          update: { $setOnInsert: { telegram_id: d.telegram_id, current_step: d.current_step, data, updated_at: d.updated_at } },
          upsert: true
        }
      };
    }));
  }

  sdb.close();
  await col('meta').updateOne(
    { _id: 'sqlite_migrated' },
    { $set: { at: Date.now(), users: oldUsers.length, logs: oldLogs.length, payments: oldPayments.length } },
    { upsert: true }
  );
  console.log(`📦 SQLite -> MongoDB migration: ${oldUsers.length} users, ${oldLogs.length} logs, ${oldPayments.length} payments`);
}

/**
 * Connect to MongoDB and load cache. Must be awaited before the bot starts.
 */
async function init() {
  if (initialized) return;
  client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  mdb = client.db(MONGODB_DB);

  await Promise.all([
    col('users').createIndex({ telegram_id: 1 }, { unique: true }),
    col('admin_sessions').createIndex({ telegram_id: 1 }, { unique: true }),
    col('user_states').createIndex({ telegram_id: 1 }, { unique: true }),
    col('sent_messages').createIndex({ chat_id: 1 }, { unique: true }),
    col('translations_log').createIndex({ telegram_id: 1 }),
    col('translations_log').createIndex({ type: 1 }),
    col('payments').createIndex({ telegram_id: 1 })
  ]);

  await migrateFromSqlite();

  // Load caches
  for (const u of await col('users').find({}).toArray()) users.set(Number(u.telegram_id), stripId(u));
  for (const s of await col('admin_sessions').find({}).toArray()) adminSessions.set(Number(s.telegram_id), stripId(s));
  for (const s of await col('user_states').find({}).toArray()) userStates.set(Number(s.telegram_id), stripId(s));
  for (const s of await col('sent_messages').find({}).toArray()) sentMessages.set(Number(s.chat_id), s.message_ids || []);

  counters.translations = await col('translations_log').countDocuments();
  counters.voices = await col('translations_log').countDocuments({ type: 'voice' });
  counters.listenings = await col('translations_log').countDocuments({ type: 'listening' });
  const starsAgg = await col('payments').aggregate([{ $group: { _id: null, total: { $sum: '$stars_amount' } } }]).toArray();
  counters.stars = starsAgg[0] ? starsAgg[0].total : 0;

  initialized = true;
  console.log(`🍃 MongoDB connected (${MONGODB_DB}): ${users.size} users loaded`);
}

async function close() {
  if (client) await client.close();
}

/**
 * Get user by Telegram ID
 */
function getUser(telegramId) {
  const user = users.get(Number(telegramId));
  if (!user) return null;

  // Check if premium expired
  if (user.tier !== 'free' && user.premium_expires_at > 0 && Date.now() > user.premium_expires_at) {
    updateUser(telegramId, { tier: 'free', premium_expires_at: 0 });
  }

  // Check if daily limit needs reset in user timezone
  checkAndResetDailyLimits(user);
  return { ...user };
}

/**
 * Get or create user
 */
function getOrCreateUser(telegramUser) {
  const telegramId = Number(telegramUser.id);
  let user = getUser(telegramId);
  const now = Date.now();

  if (!user) {
    const doc = {
      telegram_id: telegramId,
      username: telegramUser.username || '',
      first_name: telegramUser.first_name || '',
      last_name: telegramUser.last_name || '',
      language: 'uz',
      script: 'latin',
      level: 'intermediate',
      source_lang: 'auto',
      target_lang: 'ar',
      tier: 'free',
      premium_expires_at: 0,
      translate_limit_used: 0,
      voice_limit_used: 0,
      listening_limit_used: 0,
      generator_access: 0,
      generator_credits: 0,
      timezone: 'Asia/Tashkent',
      country: 'O‘zbekiston',
      region: 'Toshkent shahri',
      last_limit_reset_date: getTodayInTimezone('Asia/Tashkent'),
      total_translations: 0,
      total_voices: 0,
      total_listenings: 0,
      total_generators: 0,
      created_at: now,
      updated_at: now
    };
    users.set(telegramId, doc);
    persist(() => col('users').updateOne({ telegram_id: telegramId }, { $set: doc }, { upsert: true }));
    user = { ...doc };
  } else {
    const updates = {};
    for (const f of ['username', 'first_name', 'last_name']) {
      if (telegramUser[f] !== undefined && telegramUser[f] !== user[f]) updates[f] = telegramUser[f];
    }
    if (Object.keys(updates).length > 0) {
      updateUser(telegramId, updates);
      user = getUser(telegramId);
    }
  }

  return user;
}

/**
 * Update user fields
 */
function updateUser(telegramId, updates) {
  const id = Number(telegramId);
  if (Object.keys(updates).length === 0) return;
  const user = users.get(id);
  if (!user) return;

  const changes = { ...updates, updated_at: Date.now() };
  Object.assign(user, changes);
  persist(() => col('users').updateOne({ telegram_id: id }, { $set: changes }));
}

/**
 * Atomically increment numeric user fields
 */
function incUser(telegramId, incs) {
  const id = Number(telegramId);
  const user = users.get(id);
  if (!user) return;
  for (const [k, v] of Object.entries(incs)) user[k] = (user[k] || 0) + v;
  user.updated_at = Date.now();
  persist(() => col('users').updateOne({ telegram_id: id }, { $inc: incs, $set: { updated_at: user.updated_at } }));
}

/**
 * Get current date string YYYY-MM-DD in given timezone
 */
function getTodayInTimezone(tz) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'Asia/Tashkent',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Check and reset daily limits if local midnight passed
 */
function checkAndResetDailyLimits(user) {
  if (!user) return;
  const today = getTodayInTimezone(user.timezone);
  if (user.last_limit_reset_date !== today) {
    const cached = users.get(Number(user.telegram_id));
    const changes = {
      translate_limit_used: 0,
      voice_limit_used: 0,
      listening_limit_used: 0,
      last_limit_reset_date: today,
      updated_at: Date.now()
    };
    if (cached) Object.assign(cached, changes);
    Object.assign(user, changes);
    persist(() => col('users').updateOne({ telegram_id: Number(user.telegram_id) }, { $set: changes }));
  }
}

/**
 * Background helper: reset daily limits for every user whose local day changed
 */
function resetAllDailyLimits() {
  for (const user of users.values()) checkAndResetDailyLimits(user);
}

/**
 * Get user remaining limits
 */
function getUserLimits(user) {
  const tierConfig = config.TIERS[user.tier] || config.TIERS.free;
  return {
    tier: user.tier,
    tierName: tierConfig.title,
    translateTotal: tierConfig.translateDaily,
    translateUsed: user.translate_limit_used || 0,
    translateRemaining: Math.max(0, tierConfig.translateDaily - (user.translate_limit_used || 0)),
    voiceTotal: tierConfig.voiceDaily,
    voiceUsed: user.voice_limit_used || 0,
    voiceRemaining: Math.max(0, tierConfig.voiceDaily - (user.voice_limit_used || 0)),
    listeningTotal: tierConfig.listeningDaily,
    listeningUsed: user.listening_limit_used || 0,
    listeningRemaining: Math.max(0, tierConfig.listeningDaily - (user.listening_limit_used || 0)),
    generatorAccess: user.generator_access === 1 || user.tier === 'pro' || user.tier === 'promax',
    generatorCredits: user.generator_credits || 0,
    maxVoiceSeconds: tierConfig.maxVoiceSeconds
  };
}

/**
 * Increment limit usage
 */
function consumeLimit(telegramId, type) {
  const user = getUser(telegramId);
  if (!user) return false;

  const limits = getUserLimits(user);
  if (type === 'translate') {
    if (limits.translateRemaining <= 0) return false;
    incUser(telegramId, { translate_limit_used: 1, total_translations: 1 });
    return true;
  } else if (type === 'voice') {
    if (limits.voiceRemaining <= 0) return false;
    incUser(telegramId, { voice_limit_used: 1, total_voices: 1 });
    return true;
  } else if (type === 'listening') {
    if (limits.listeningRemaining <= 0) return false;
    incUser(telegramId, { listening_limit_used: 1, total_listenings: 1 });
    return true;
  } else if (type === 'generator') {
    if (user.generator_credits <= 0) return false;
    incUser(telegramId, { generator_credits: -1, total_generators: 1 });
    return true;
  }
  return false;
}

/**
 * Log translation activity
 */
function logTranslation(telegramId, type, sourceLang, targetLang, textLength = 0) {
  counters.translations++;
  if (type === 'voice') counters.voices++;
  if (type === 'listening') counters.listenings++;
  const doc = {
    telegram_id: Number(telegramId),
    type,
    source_lang: sourceLang,
    target_lang: targetLang,
    text_length: textLength,
    created_at: Date.now()
  };
  persist(() => col('translations_log').insertOne(doc));
}

/**
 * Record payment
 */
function logPayment(telegramId, paymentType, starsAmount, chargeId = '', providerChargeId = '') {
  counters.stars += Number(starsAmount) || 0;
  const doc = {
    telegram_id: Number(telegramId),
    payment_type: paymentType,
    stars_amount: starsAmount,
    telegram_payment_charge_id: chargeId,
    provider_payment_charge_id: providerChargeId,
    status: 'completed',
    created_at: Date.now()
  };
  persist(() => col('payments').insertOne(doc));
}

/**
 * Admin sessions management
 */
function createAdminSession(telegramId, durationMinutes = 120) {
  const id = Number(telegramId);
  const now = Date.now();
  const doc = { telegram_id: id, authenticated_at: now, expires_at: now + durationMinutes * 60 * 1000 };
  adminSessions.set(id, doc);
  persist(() => col('admin_sessions').updateOne({ telegram_id: id }, { $set: doc }, { upsert: true }));
}

function verifyAdminSession(telegramId) {
  const row = adminSessions.get(Number(telegramId));
  if (!row) return false;
  if (Date.now() > row.expires_at) {
    deleteAdminSession(telegramId);
    return false;
  }
  return true;
}

function deleteAdminSession(telegramId) {
  const id = Number(telegramId);
  adminSessions.delete(id);
  persist(() => col('admin_sessions').deleteOne({ telegram_id: id }));
}

/**
 * Track sent bot messages for /delete cleanup
 */
function trackSentMessage(chatId, messageId) {
  const id = Number(chatId);
  const list = sentMessages.get(id) || [];
  list.push(Number(messageId));
  if (list.length > SENT_MESSAGES_KEEP) list.splice(0, list.length - SENT_MESSAGES_KEEP);
  sentMessages.set(id, list);
  persist(() => col('sent_messages').updateOne(
    { chat_id: id },
    { $push: { message_ids: { $each: [Number(messageId)], $slice: -SENT_MESSAGES_KEEP } } },
    { upsert: true }
  ));
}

function getRecentSentMessages(chatId, limit = 50) {
  const list = sentMessages.get(Number(chatId)) || [];
  return list.slice(-limit).reverse().map(message_id => ({ message_id }));
}

function clearSentMessages(chatId) {
  const id = Number(chatId);
  sentMessages.delete(id);
  persist(() => col('sent_messages').deleteOne({ chat_id: id }));
}

/**
 * User conversation state for multi-step flows
 */
function getUserState(telegramId) {
  const row = userStates.get(Number(telegramId));
  if (!row) return null;
  return { currentStep: row.current_step, data: JSON.parse(JSON.stringify(row.data || {})) };
}

function setUserState(telegramId, step, data = {}) {
  const id = Number(telegramId);
  const doc = { telegram_id: id, current_step: step, data: JSON.parse(JSON.stringify(data)), updated_at: Date.now() };
  userStates.set(id, doc);
  persist(() => col('user_states').replaceOne({ telegram_id: id }, doc, { upsert: true }));
}

function clearUserState(telegramId) {
  const id = Number(telegramId);
  userStates.delete(id);
  persist(() => col('user_states').deleteOne({ telegram_id: id }));
}

/**
 * Admin stats & user queries
 */
function getStats() {
  let proCount = 0;
  let promaxCount = 0;
  for (const u of users.values()) {
    if (u.tier === 'pro') proCount++;
    else if (u.tier === 'promax') promaxCount++;
  }
  const userCount = users.size;
  return {
    userCount,
    proCount,
    promaxCount,
    freeCount: userCount - proCount - promaxCount,
    totalTranslations: counters.translations,
    totalStars: counters.stars,
    totalVoices: counters.voices,
    totalListenings: counters.listenings
  };
}

function getAllUsers(page = 1, pageSize = 10, search = '') {
  let list = Array.from(users.values());
  if (search) {
    const s = String(search).toLowerCase();
    list = list.filter(u =>
      String(u.telegram_id).includes(s) ||
      (u.username || '').toLowerCase().includes(s) ||
      (u.first_name || '').toLowerCase().includes(s)
    );
  }
  list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const total = list.length;
  const offset = (page - 1) * pageSize;
  return {
    users: list.slice(offset, offset + pageSize).map(u => ({ ...u })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  };
}

module.exports = {
  init,
  close,
  getUser,
  getOrCreateUser,
  updateUser,
  getUserLimits,
  consumeLimit,
  logTranslation,
  logPayment,
  createAdminSession,
  verifyAdminSession,
  deleteAdminSession,
  trackSentMessage,
  getRecentSentMessages,
  clearSentMessages,
  getUserState,
  setUserState,
  clearUserState,
  getStats,
  getAllUsers,
  getTodayInTimezone,
  resetAllDailyLimits
};
