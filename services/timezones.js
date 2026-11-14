const config = require('../config');

/**
 * Get current time details and countdown until midnight (00:00) in user's timezone
 */
function getTimezoneInfo(timezone = 'Asia/Tashkent') {
  const tz = timezone || 'Asia/Tashkent';
  const now = new Date();

  try {
    // Current date and time in user's timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const parts = formatter.formatToParts(now);
    const map = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }

    const hour = parseInt(map.hour, 10);
    const minute = parseInt(map.minute, 10);
    const second = parseInt(map.second, 10);

    // Seconds elapsed today
    const secondsElapsed = (hour * 3600) + (minute * 60) + second;
    const totalDaySeconds = 86400;
    const secondsRemaining = totalDaySeconds - secondsElapsed;

    const remHours = Math.floor(secondsRemaining / 3600);
    const remMinutes = Math.floor((secondsRemaining % 3600) / 60);
    const remSeconds = secondsRemaining % 60;

    const timeString = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
    const dateString = `${map.year}-${map.month}-${map.day}`;

    return {
      timezone: tz,
      currentTime: timeString,
      currentDate: dateString,
      remainingHours: remHours,
      remainingMinutes: remMinutes,
      remainingSeconds: remSeconds,
      formattedCountdown: `${remHours} soat ${remMinutes} daqiqa`
    };
  } catch (e) {
    // Fallback if invalid timezone
    return {
      timezone: 'Asia/Tashkent',
      currentTime: '00:00',
      currentDate: new Date().toISOString().slice(0, 10),
      remainingHours: 1,
      remainingMinutes: 0,
      remainingSeconds: 0,
      formattedCountdown: '1 soat 0 daqiqa'
    };
  }
}

/**
 * Find country by code or name
 */
function findCountry(query) {
  if (!query) return config.COUNTRIES[0];
  const q = String(query).toLowerCase();
  return config.COUNTRIES.find(c => 
    c.code.toLowerCase() === q || 
    c.name.toLowerCase().includes(q) ||
    c.tz.toLowerCase().includes(q)
  ) || config.COUNTRIES[0];
}

module.exports = {
  getTimezoneInfo,
  findCountry
};
