const fs = require('fs');
const path = require('path');
const { EdgeTTS } = require('node-edge-tts');
const config = require('../config');

const AUDIO_DIR = path.join(__dirname, '../data/audio_temp');
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

/**
 * Generate natural speech audio file for given text and language
 * @param {string} text - The text to synthesize
 * @param {string} langCode - Language code (e.g. 'uz', 'ar', 'en')
 * @returns {Promise<string>} - Absolute path to generated mp3 file
 */
async function generateSpeechAudio(text, langCode = 'ar') {
  const lang = config.LANGUAGES[langCode] || config.LANGUAGES.ar;
  const voice = lang.ttsVoice || 'ar-SA-HamedNeural';

  // Sanitize text for TTS (remove markdown asterisks, hashtags, urls)
  const cleanText = text
    .replace(/[*_`#~>[\]()]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();

  // Truncate if too long (max 3000 chars for a single audio file)
  const safeText = cleanText.slice(0, 3000);

  const filename = `tts_${langCode}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
  const filePath = path.join(AUDIO_DIR, filename);

  try {
    const tts = new EdgeTTS({ voice });
    await tts.ttsPromise(safeText, filePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
      return filePath;
    }
    throw new Error('TTS audio file empty or not generated');
  } catch (error) {
    console.error(`Edge TTS failed for voice ${voice}:`, error.message);
    
    // Fallback: try English voice if native voice failed
    if (voice !== 'en-US-JennyNeural') {
      try {
        const fallbackTts = new EdgeTTS({ voice: 'en-US-JennyNeural' });
        await fallbackTts.ttsPromise(safeText, filePath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
          return filePath;
        }
      } catch (e) {
        console.error('Fallback English TTS also failed:', e.message);
      }
    }
    throw error;
  }
}

/**
 * Clean up temp audio file
 */
function cleanupAudioFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    // ignore
  }
}

module.exports = {
  generateSpeechAudio,
  cleanupAudioFile
};
