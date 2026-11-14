const axios = require('axios');
const config = require('../config');
const { toScript } = require('./transliterate');

/**
 * Call Google Gemini REST API
 */
async function callGemini(contents, systemInstruction = '', model = null) {
  const apiKey = config.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
  }

  const modelName = model || config.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const payload = {
    contents: Array.isArray(contents) ? contents : [{ parts: [{ text: String(contents) }] }]
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000
  });

  const candidate = response.data?.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text).join('') || '';
  return text.trim();
}

/**
 * Fallback translation using MyMemory API
 */
async function fallbackTranslate(text, sourceLang = 'auto', targetLang = 'uz') {
  try {
    const sl = sourceLang === 'auto' ? 'en' : sourceLang;
    const tl = targetLang;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${sl}|${tl}`;
    const res = await axios.get(url, { timeout: 10000 });
    const translated = res.data?.responseData?.translatedText;
    if (translated && !translated.includes('MYMEMORY WARNING')) {
      return translated;
    }
    return text;
  } catch (e) {
    return text;
  }
}

/**
 * Core text translation with level-aware linguistic explanation
 */
async function translateText({ text, sourceLang = 'auto', targetLang = 'ar', level = 'intermediate', script = 'latin' }) {
  const src = sourceLang === 'auto' ? 'Auto-detect' : (config.LANGUAGES[sourceLang]?.name || sourceLang);
  const tgt = config.LANGUAGES[targetLang]?.name || targetLang;
  const levelObj = config.LEVELS[level] || config.LEVELS.intermediate;

  const systemInstruction = `You are a world-class professional linguist and translator specializing in 15 world languages, with deep mastery of Arabic and Uzbek.
Target Language: ${tgt} (${targetLang}).
Source Language: ${src}.
User Knowledge Level: ${levelObj.label} (${levelObj.desc}).
Target Script for Uzbek: ${script === 'cyrillic' ? 'Uzbek Cyrillic (Ўзбекча Кирилл)' : 'Uzbek Latin (O‘zbekcha Lotin)'}.

Formatting Guidelines:
1. Provide the direct, highest quality translation first.
2. If translating to or from Arabic, include full diacritics / harakat (tashkeel: fathah, dammah, kasrah, sukun) for clarity.
3. Provide phonetic transcription or transliteration in Latin letters if the target script is Arabic, Russian, Chinese, Japanese, Korean, or Hindi.
4. Adapt the vocabulary and grammar notes strictly to the user's level (${levelObj.label}):
   - Beginner / A1: simple explanation, breakdown of main words, 1 simple example.
   - Intermediate / B1-B2: key vocabulary list, idioms/phrases, 1-2 natural examples.
   - Advanced / C1-C2: stylistic nuances, formal grammar breakdown, synonyms, cultural context.
5. Format cleanly using emoji icons:
   🌐 **Tarjima** (Translation)
   🔤 **Talaffuz / Transkripsiya** (Pronunciation / Transliteration, if relevant)
   💡 **Izoh va Ma'nosi** (Grammar / Vocabulary Explanation)
   ✨ **Misollar va Qo'llanishi** (Usage Example)
Output in polite, clear language accessible to users aged 10-60.`;

  try {
    const prompt = `Translate the following text from ${src} to ${tgt}:

"""${text}"""`;

    let result = await callGemini(prompt, systemInstruction);
    if (targetLang === 'uz' && script === 'cyrillic') {
      result = toScript(result, 'cyrillic');
    }
    return { success: true, text: result, engine: 'gemini' };
  } catch (error) {
    console.warn('Gemini translate failed or not configured, using fallback:', error.message);
    const simple = await fallbackTranslate(text, sourceLang, targetLang);
    let formatted = `🌐 **Tarjima:**\n${simple}\n\n💡 *Oddiy rejimda tarjima qilindi.*`;
    if (targetLang === 'uz' && script === 'cyrillic') {
      formatted = toScript(formatted, 'cyrillic');
    }
    return { success: true, text: formatted, engine: 'fallback' };
  }
}

/**
 * Speech-to-Text and Translation for /voice
 */
async function transcribeAndTranslateVoice({ audioBuffer, mimeType = 'audio/ogg', targetLang = 'uz', level = 'intermediate', script = 'latin' }) {
  const tgt = config.LANGUAGES[targetLang]?.name || targetLang;
  const levelObj = config.LEVELS[level] || config.LEVELS.intermediate;
  const base64Audio = audioBuffer.toString('base64');

  const systemInstruction = `You are an expert Speech-to-Text and audio translation AI.
1. Listen carefully to the user's voice message in ANY of the 15 supported languages (Arabic, Uzbek, English, Russian, French, Turkish, etc.).
2. Accurately transcribe what was spoken in the original language.
3. Translate the transcribed message into ${tgt} (${targetLang}).
4. If Uzbek, use ${script === 'cyrillic' ? 'Cyrillic (Кирилл)' : 'Latin (Lotin)'} script.
5. Provide a brief explanation suited to level ${levelObj.label}.

Format your response strictly as:
🗣 **Eshitilgan asl matn:**
[Original transcribed text with diacritics if Arabic]

🌐 **Tarjimasi (${tgt}):**
[Accurate translation]

💡 **Izoh va lug'at:**
[Key words and short explanation]`;

  try {
    const contents = [
      {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          },
          {
            text: `Please transcribe this voice message accurately and translate it into ${tgt}.`
          }
        ]
      }
    ];

    let result = await callGemini(contents, systemInstruction);
    if (targetLang === 'uz' && script === 'cyrillic') {
      result = toScript(result, 'cyrillic');
    }
    return { success: true, text: result };
  } catch (error) {
    console.error('Voice transcription failed:', error.message);
    throw new Error('Ovozli xabarni tahlil qilishda xatolik yuz berdi. API kalitini tekshiring yoki ovozni qaytadan yuboring.');
  }
}

/**
 * Listening Analysis: Audio + Image comparison
 */
async function analyzeListeningTask({ audioBuffer, audioMime = 'audio/ogg', imageBuffer, imageMime = 'image/jpeg', userLang = 'uz', script = 'latin' }) {
  const systemInstruction = `You are an expert language listening test examiner and auditor.
You are given TWO inputs from a language learning session:
1. An audio recording of a person speaking or a listening comprehension track.
2. An image (photo of textbook, worksheet, written dialogue, or exercise).

Your mission:
1. Transcribe the audio recording word-for-word (STT).
2. Extract the written text from the image (OCR).
3. Compare the audio transcript against the image text.
4. Check if they match:
   - Identify words spoken that were not in the text.
   - Identify words in the text that were skipped or misread.
   - Identify pronunciation or grammatical differences.
5. Provide a similarity percentage (0-100%).
6. Provide constructive correction and aligned final script.

Format your output in clear Uzbek (${script === 'cyrillic' ? 'Cyrillic' : 'Latin'}):
🎧 **1. Ovozli fayldan eshitilgan matn:**
[Transcribed speech]

📄 **2. Rasmdagi yozuv (OCR):**
[Text read from image]

🔍 **3. Solishtirish tahlili:**
- Moslik darajasi: [XX]%
- Holat: [✅ To'liq mos keldi / ⚠️ Farqlar va noaniqliklar aniqlandi]

⚠️ **4. Aniq factorlar va farqlar:**
[Bullet points of differences or "Hech qanday farq yo'q, audio va rasm to'liq mos!"]

📝 **5. To'g'rilangan yakuniy matn va tavsiya:**
[Final correct text]`;

  try {
    const contents = [
      {
        parts: [
          {
            inlineData: {
              mimeType: audioMime,
              data: audioBuffer.toString('base64')
            }
          },
          {
            inlineData: {
              mimeType: imageMime,
              data: imageBuffer.toString('base64')
            }
          },
          {
            text: `Please analyze this listening recording and textbook image. Transcribe both, compare them rigorously, check for discrepancies, and output the analysis in Uzbek.`
          }
        ]
      }
    ];

    let result = await callGemini(contents, systemInstruction);
    if (script === 'cyrillic') {
      result = toScript(result, 'cyrillic');
    }
    return { success: true, text: result };
  } catch (error) {
    console.error('Listening analysis failed:', error.message);
    throw new Error('Listening tahlilida xatolik yuz berdi. Iltimos, audio va rasm ravshanligini tekshirib, qayta urinib ko‘ring.');
  }
}

/**
 * Generator: Create complete listening material with spoken script + questions
 */
async function generateListeningMaterial({ language = 'ar', level = 'intermediate', topic = 'Kundalik muloqot', pages = '7', script = 'latin' }) {
  const langObj = config.LANGUAGES[language] || config.LANGUAGES.ar;
  const levelObj = config.LEVELS[level] || config.LEVELS.intermediate;

  const systemInstruction = `You are a master curriculum creator for language learning institutes.
You design premium listening comprehension exercises in ${langObj.name} (${langObj.native}).
Level: ${levelObj.label} (${levelObj.desc}).
Topic: ${topic}.
Target Volume: Approximately ${pages} pages of rich curriculum material.

Structure requirements:
1. === AUDIO SCRIPT === (This exact marker must surround the spoken text for audio synthesis)
   Write a rich, authentic dialogue or narrative in ${langObj.native}.
   If Arabic, include full diacritics / tashkeel for crystal-clear pronunciation.
   Duration should match the requested scale.
   === END AUDIO SCRIPT ===
2. O‘zbekcha tarjimasi (Translation into Uzbek, ${script === 'cyrillic' ? 'Cyrillic' : 'Latin'}).
3. Yangi so‘zlar va iboralar lug‘ati (Vocabulary & phrase glossary with meanings).
4. Tinglab tushunish savollari (Comprehension questions: 5 Multiple Choice + 3 Open Questions).
5. To‘g‘ri javoblar kaliti (Answer key with brief explanations).`;

  try {
    const prompt = `Create a comprehensive, professional listening exercise in ${langObj.name} (${langObj.native}) on the topic "${topic}" for level ${levelObj.label}. Size scale: ${pages} pages.`;
    let result = await callGemini(prompt, systemInstruction);
    if (script === 'cyrillic') {
      // Convert only Uzbek portions or entire text if needed
      result = toScript(result, 'cyrillic');
    }

    // Extract the audio script part for TTS
    let audioScript = '';
    const match = result.match(/=== AUDIO SCRIPT ===([\s\S]*?)=== END AUDIO SCRIPT ===/i);
    if (match && match[1]) {
      audioScript = match[1].trim();
    } else {
      // Fallback: take first 1000 characters
      audioScript = result.slice(0, 1000);
    }

    return {
      success: true,
      fullText: result,
      audioScript: audioScript,
      language: language
    };
  } catch (error) {
    console.error('Listening generation failed:', error.message);
    throw new Error('Listening material yaratishda xatolik yuz berdi: ' + error.message);
  }
}

module.exports = {
  callGemini,
  translateText,
  transcribeAndTranslateVoice,
  analyzeListeningTask,
  generateListeningMaterial
};
