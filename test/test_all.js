const assert = require('assert');
const config = require('../config');
process.env.MONGODB_DB = process.env.MONGODB_TEST_DB || 'arab_tarjima_bot_test';
const db = require('../database');
const { latinToCyrillic, cyrillicToLatin, toScript } = require('../services/transliterate');
const { getTimezoneInfo, findCountry } = require('../services/timezones');
const { generateSpeechAudio, cleanupAudioFile } = require('../services/tts');

async function runTests() {
  // Start from a clean test database every run
  const { MongoClient } = require('mongodb');
  const tmp = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
  await tmp.connect();
  await tmp.db(process.env.MONGODB_DB).dropDatabase();
  await tmp.close();
  await db.init();
  console.log('🧪 Starting Arab Tarjima Bot Test Suite...\n');

  // 1. Config tests
  console.log('1. Checking configuration:');
  assert.strictEqual(Object.keys(config.LANGUAGES).length, 15, 'Must have exactly 15 languages');
  assert(config.ADMIN_PASSWORD, 'ADMIN_PASSWORD must be set in .env');
  assert(config.LANGUAGES.uz && config.LANGUAGES.en && config.LANGUAGES.ru && config.LANGUAGES.ar, 'Essential languages must exist');
  assert.strictEqual(config.TIERS.free.translateDaily, 30, 'Free translate limit must be 30');
  assert.strictEqual(config.TIERS.free.voiceDaily, 20, 'Free voice limit must be 20');
  assert.strictEqual(config.TIERS.pro.priceStars, 50, 'PRO price must be 50 Stars');
  assert.strictEqual(config.TIERS.promax.priceStars, 120, 'PRO MAX price must be 120 Stars');
  assert.strictEqual(config.PRICES.GENERATOR_UNLOCK, 250, 'Generator unlock must be 250 Stars');
  assert.strictEqual(config.PRICES.PAY_SUPPORT_RECOMMENDED, 1000, 'Pay support recommended must be 1000 Stars');
  console.log('   ✅ Config validation passed!\n');

  // 2. Transliteration tests
  console.log('2. Checking Uzbek Latin <-> Cyrillic transliteration:');
  const latSample = 'Assalomu alaykum! O‘zbekiston vatanimiz. Shoshilmang, g‘alaba bizniki!';
  const cyrSample = latinToCyrillic(latSample);
  assert(cyrSample.includes('Ўзбекистон'), 'Cyrillic must contain Ўзбекистон');
  assert(cyrSample.includes('Шошилманг'), 'Cyrillic must contain Шошилманг');
  assert(cyrSample.includes('ғалаба'), 'Cyrillic must contain ғалаба');
  const backLat = cyrillicToLatin(cyrSample);
  assert(backLat.includes("O'zbekiston"), "Back to Latin must contain O'zbekiston");
  console.log('   ✅ Transliteration passed!\n');

  // 3. Database tests
  console.log('3. Checking Database operations:');
  const testId = 999888777;
  const user = db.getOrCreateUser({ id: testId, username: 'testuser99', first_name: 'Bobur' });
  assert.strictEqual(user.telegram_id, testId);
  assert.strictEqual(user.tier, 'free');

  // Limits check
  const limitsBefore = db.getUserLimits(user);
  assert.strictEqual(limitsBefore.translateRemaining, 30);
  assert.strictEqual(limitsBefore.voiceRemaining, 20);

  // Consume translate limit
  const consumed = db.consumeLimit(testId, 'translate');
  assert.strictEqual(consumed, true);
  const userAfter = db.getUser(testId);
  const limitsAfter = db.getUserLimits(userAfter);
  assert.strictEqual(limitsAfter.translateRemaining, 29);

  // Admin session test
  db.createAdminSession(testId, 60);
  assert.strictEqual(db.verifyAdminSession(testId), true, 'Admin session must be verified');
  db.deleteAdminSession(testId);
  assert.strictEqual(db.verifyAdminSession(testId), false, 'Admin session must be deleted');
  console.log('   ✅ Database operations passed!\n');

  // 4. Timezone & Midnight countdown tests
  console.log('4. Checking Timezones and Midnight countdown:');
  const uzTz = getTimezoneInfo('Asia/Tashkent');
  assert(uzTz.currentTime, 'Current time must be formatted');
  assert(uzTz.remainingHours >= 0 && uzTz.remainingHours <= 23, 'Remaining hours must be 0-23');
  assert(uzTz.remainingMinutes >= 0 && uzTz.remainingMinutes <= 59, 'Remaining minutes must be 0-59');
  console.log(`   Tashkent current: ${uzTz.currentTime}, countdown to 00:00: ${uzTz.formattedCountdown}`);
  console.log('   ✅ Timezones passed!\n');

  // 5. Neural TTS speech synthesis test
  console.log('5. Checking Neural TTS speech synthesis:');
  const audioFile = await generateSpeechAudio('Tinglash mashqi muvaffaqiyatli ishga tushdi.', 'uz');
  assert(audioFile, 'Audio file path must be returned');
  const fs = require('fs');
  const stats = fs.statSync(audioFile);
  assert(stats.size > 1000, 'Audio file size must be > 1000 bytes');
  console.log(`   Uzbek TTS generated: ${stats.size} bytes`);
  cleanupAudioFile(audioFile);
  console.log('   ✅ Neural TTS passed!\n');

  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! 🚀');
  await new Promise(r => setTimeout(r, 500)); // let async writes finish
  await db.close();
}

runTests().catch(e => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
