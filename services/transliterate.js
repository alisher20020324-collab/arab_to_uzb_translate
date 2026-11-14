/**
 * Uzbek Latin <-> Cyrillic Transliteration Engine
 * Complete, accurate bidirectional transliterator for Uzbek language.
 */

const LATIN_TO_CYRILLIC_COMPOUND = [
  { lat: 'sh', cyr: 'ш' },
  { lat: 'ch', cyr: 'ч' },
  { lat: 'yo', cyr: 'ё' },
  { lat: 'yu', cyr: 'ю' },
  { lat: 'ya', cyr: 'я' },
  { lat: 'ye', cyr: 'е' },
  { lat: 'ts', cyr: 'ц' },
  { lat: "o'", cyr: 'ў' },
  { lat: "o‘", cyr: 'ў' },
  { lat: "oʻ", cyr: 'ў' },
  { lat: "o’", cyr: 'ў' },
  { lat: "g'", cyr: 'ғ' },
  { lat: "g‘", cyr: 'ғ' },
  { lat: "gʻ", cyr: 'ғ' },
  { lat: "g’", cyr: 'ғ' }
];

const LATIN_TO_CYRILLIC_SINGLE = {
  'a': 'а', 'b': 'б', 'd': 'д', 'e': 'е', 'f': 'ф',
  'g': 'г', 'h': 'ҳ', 'i': 'и', 'j': 'ж', 'k': 'к',
  'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п',
  'q': 'қ', 'r': 'р', 's': 'с', 't': 'т', 'u': 'у',
  'v': 'в', 'x': 'х', 'y': 'й', 'z': 'з',
  "'": 'ъ', "’": 'ъ', "ʻ": 'ъ', "‘": 'ъ'
};

const CYRILLIC_TO_LATIN = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd',
  'е': 'e', 'ё': 'yo', 'ж': 'j', 'з': 'z', 'и': 'i',
  'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
  'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
  'у': 'u', 'ф': 'f', 'х': 'x', 'ц': 'ts', 'ч': 'ch',
  'ш': 'sh', 'ъ': "'", 'ь': '', 'э': 'e', 'ю': 'yu',
  'я': 'ya', 'ў': "o'", 'қ': 'q', 'ғ': "g'", 'ҳ': 'h'
};

function matchCase(source, target) {
  if (!source || !target) return target;
  if (source === source.toUpperCase()) {
    // If target has multiple chars (e.g. 'sh', 'yo'), capitalize properly:
    // If source was single char (e.g. Cyrillic 'Ш'), target should be 'Sh' or 'SH' if surrounding is upper
    if (source.length === 1 && target.length > 1) {
      return target[0].toUpperCase() + target.slice(1).toLowerCase();
    }
    return target.toUpperCase();
  }
  if (source[0] === source[0].toUpperCase()) {
    return target[0].toUpperCase() + target.slice(1).toLowerCase();
  }
  return target.toLowerCase();
}

/**
 * Convert Uzbek Latin text to Uzbek Cyrillic text
 */
function latinToCyrillic(text) {
  if (!text || typeof text !== 'string') return text;

  // Handle word-initial 'e' -> 'э'
  let processed = text.replace(/(^|[\s.,!?;:()[\]{}"'«»—–\/\\])e/gi, (match, prefix) => {
    const isUpper = match.slice(prefix.length) === match.slice(prefix.length).toUpperCase();
    return prefix + (isUpper ? 'Э' : 'э');
  });

  // Handle compound letters (sh, ch, yo, yu, ya, ye, o', g')
  for (const item of LATIN_TO_CYRILLIC_COMPOUND) {
    const regex = new RegExp(item.lat.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1"), 'gi');
    processed = processed.replace(regex, (match) => matchCase(match, item.cyr));
  }

  // Handle single letters
  let result = '';
  for (let i = 0; i < processed.length; i++) {
    const char = processed[i];
    const lower = char.toLowerCase();
    if (LATIN_TO_CYRILLIC_SINGLE[lower] !== undefined) {
      result += matchCase(char, LATIN_TO_CYRILLIC_SINGLE[lower]);
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Convert Uzbek Cyrillic text to Uzbek Latin text
 */
function cyrillicToLatin(text) {
  if (!text || typeof text !== 'string') return text;

  // Handle word-initial 'е' -> 'ye'
  let processed = text.replace(/(^|[\s.,!?;:()[\]{}"'«»—–\/\\])е/gi, (match, prefix) => {
    const char = match.slice(prefix.length);
    const isUpper = char === char.toUpperCase();
    return prefix + (isUpper ? 'Ye' : 'ye');
  });

  let result = '';
  for (let i = 0; i < processed.length; i++) {
    const char = processed[i];
    const lower = char.toLowerCase();
    if (CYRILLIC_TO_LATIN[lower] !== undefined) {
      result += matchCase(char, CYRILLIC_TO_LATIN[lower]);
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Apply script based on user preference ('latin' or 'cyrillic')
 */
function toScript(text, script) {
  if (!text) return text;
  if (script === 'cyrillic') {
    return latinToCyrillic(text);
  }
  return text; // default latin
}

module.exports = {
  latinToCyrillic,
  cyrillicToLatin,
  toScript
};
