export function fixEncoding(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/â€¢/g, '•')
    .replace(/â†'/g, '→')
    .replace(/â†'/g, '←')
    .replace(/â€"/g, '—')
    .replace(/â€˜/g, "'")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€¦/g, '…')
    .replace(/Ã©/g, 'é')
    .replace(/Ã¨/g, 'è')
    .replace(/Ã±/g, 'ñ')
    .replace(/Ã¼/g, 'ü')
    .replace(/Ã¶/g, 'ö')
    .replace(/Ã¤/g, 'ä')
    .replace(/ÃŸ/g, 'ß')
    .replace(/Ã /g, 'à')
    .replace(/Ã¢/g, 'â')
    .replace(/Ãª/g, 'ê')
    .replace(/Ã«/g, 'ë')
    .replace(/Ã®/g, 'î')
    .replace(/Ã´/g, 'ô')
    .replace(/Ã¹/g, 'ù')
    .replace(/Ã»/g, 'û')
    .replace(/Ã§/g, 'ç')
    .replace(/Å“/g, 'œ')
    .replace(/Ä/g, 'ä')
    .replace(/Å¸/g, 'ÿ')
    .replace(/Ã /g, ' ')
    .replace(/[ðŸ]/g, (match) => {
      return match;
    });
}

export function fixObjectEncoding(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(fixObjectEncoding);
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = typeof value === 'string' ? fixEncoding(value)
      : typeof value === 'object' ? fixObjectEncoding(value)
      : value;
  }
  return result;
}
