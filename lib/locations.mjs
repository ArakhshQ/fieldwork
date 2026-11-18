// Turning messy job-board location strings into US city/state pairs, and
// measuring distance between cities. City coordinates come from the
// MIT-licensed US-Cities-Database (see data/LICENSE-us-cities.txt).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const BY_NAME = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v.toLowerCase(), k]));

// Shorthand that job boards use instead of a city and state.
const ALIASES = {
  nyc: ['New York', 'NY'],
  'new york city': ['New York', 'NY'],
  manhattan: ['New York', 'NY'],
  brooklyn: ['Brooklyn', 'NY'],
  sf: ['San Francisco', 'CA'],
  'sf bay area': ['San Francisco', 'CA'],
  'bay area': ['San Francisco', 'CA'],
  'san francisco bay area': ['San Francisco', 'CA'],
  'silicon valley': ['San Jose', 'CA'],
  'greater boston': ['Boston', 'MA'],
  'boston area': ['Boston', 'MA'],
  la: ['Los Angeles', 'CA'],
  'greater los angeles': ['Los Angeles', 'CA'],
  'washington dc': ['Washington', 'DC'],
  'washington, d.c.': ['Washington', 'DC'],
  dc: ['Washington', 'DC'],
};
// Well-known cities that boards often list without a state.
const MAJOR = {
  'new york': 'NY', boston: 'MA', cambridge: 'MA', somerville: 'MA', waltham: 'MA',
  'san francisco': 'CA', 'los angeles': 'CA', 'san jose': 'CA', 'palo alto': 'CA',
  'mountain view': 'CA', 'menlo park': 'CA', 'redwood city': 'CA', 'san mateo': 'CA',
  sunnyvale: 'CA', 'santa clara': 'CA', oakland: 'CA', berkeley: 'CA', 'san diego': 'CA',
  irvine: 'CA', 'santa monica': 'CA', seattle: 'WA', bellevue: 'WA', chicago: 'IL',
  austin: 'TX', dallas: 'TX', houston: 'TX', denver: 'CO', boulder: 'CO', atlanta: 'GA',
  miami: 'FL', philadelphia: 'PA', pittsburgh: 'PA', washington: 'DC', 'jersey city': 'NJ',
  princeton: 'NJ', stamford: 'CT', 'new haven': 'CT', providence: 'RI', 'ann arbor': 'MI',
  detroit: 'MI', raleigh: 'NC', durham: 'NC', 'salt lake city': 'UT', portland: 'OR',
  phoenix: 'AZ', minneapolis: 'MN', baltimore: 'MD', nashville: 'TN', columbus: 'OH',
};
// Boards often name the metro or neighbourhood; map to a city in the table.
const CITY_FIX = { 'new york city': 'new york', 'st. louis': 'saint louis', 'st louis': 'saint louis' };

let cities = null;
function table() {
  if (!cities) {
    const file = fileURLToPath(new URL('../data/us-cities.json', import.meta.url));
    try {
      cities = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      cities = {};
    }
  }
  return cities;
}

export const stateCode = (value) => {
  if (!value) return '';
  const v = String(value).trim();
  if (STATES[v.toUpperCase()] && v.length === 2) return v.toUpperCase();
  return BY_NAME[v.toLowerCase()] || '';
};
export const stateName = (code) => STATES[code] || '';

export function coordinates(city, state) {
  const st = stateCode(state);
  if (!city || !st) return null;
  const key = city.trim().toLowerCase();
  return table()[st]?.[CITY_FIX[key] || key] || null;
}

export function distanceMiles(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const NON_US = /\b(canada|toronto|vancouver|montreal|ontario|united kingdom|uk|london|dublin|ireland|germany|berlin|munich|france|paris|india|bangalore|bengaluru|hyderabad|singapore|japan|tokyo|australia|sydney|brazil|mexico|netherlands|amsterdam|spain|poland|israel|tel aviv|china|hong kong|korea|seoul|switzerland|zurich|sweden|stockholm|emea|apac|latam|europe)\b/i;

/**
 * Parse a location string such as "Boston, MA; New York, NY", "Remote - US",
 * "San Francisco, California, United States" or "NYC".
 * @returns {{ places: {city: string, state: string}[], remote: boolean, nonUs: boolean }}
 */
export function parseLocation(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  const places = [];
  const remote = /\b(remote|anywhere|distributed|work from home|wfh)\b/i.test(text);
  // Lower-case "or"/"and" only, so the Oregon code "OR" is never a separator.
  for (let part of text.split(/\s*(?:;|\||\/|•)\s*|\s+(?:or|and)\s+/)) {
    part = part
      .replace(/\b(remote|hybrid|on-?site|in-?office|office)\b/gi, '')
      .replace(/\b(united states( of america)?|usa|u\.s\.a?\.?|us)\b/gi, '')
      .replace(/[()]/g, ' ')
      .replace(/^[\s,\-–:]+|[\s,\-–:]+$/g, '')
      .trim();
    if (!part) continue;
    const alias = ALIASES[part.toLowerCase()];
    if (alias) {
      places.push({ city: alias[0], state: alias[1] });
      continue;
    }
    const bits = part.split(',').map((s) => s.trim()).filter(Boolean);
    if (bits.length >= 2) {
      const st = stateCode(bits[1]);
      if (st) {
        const cityAlias = ALIASES[bits[0].toLowerCase()];
        places.push(cityAlias ? { city: cityAlias[0], state: cityAlias[1] } : { city: bits[0], state: st });
        continue;
      }
    }
    const major = MAJOR[part.toLowerCase()];
    if (major) {
      places.push({ city: part.replace(/\b\w/g, (c) => c.toUpperCase()), state: major });
      continue;
    }
    // A bare state ("California") or "City ST" without a comma.
    const bare = stateCode(part);
    if (bare) {
      places.push({ city: '', state: bare });
      continue;
    }
    const m = part.match(/^(.+?)\s+([A-Z]{2})$/);
    if (m && STATES[m[2]]) places.push({ city: m[1].trim(), state: m[2] });
  }
  const unique = [];
  for (const p of places)
    if (!unique.some((u) => u.city.toLowerCase() === p.city.toLowerCase() && u.state === p.state)) unique.push(p);
  return { places: unique, remote, nonUs: !unique.length && NON_US.test(text) };
}
