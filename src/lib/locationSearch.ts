/**
 * Manual pickup search for the patient screen.
 *
 * Accepts what a caller types: a building, society, apartment, hospital, landmark, area, or
 * coordinates ("23.0225, 72.5714"). House numbers, sector numbers and common misspellings are
 * understood ("nilakunj 936/2 sector 7c pathikasharm gandhingar").
 *
 * Result types, most precise first:
 *   exact       the building/landmark was found in OpenStreetMap or Photon, and its name matches
 *               every distinctive word typed (a wrong place is never returned as exact)
 *   locality    the building is not mapped; the named locality/society is shown (approximate)
 *   sector      the Gandhinagar sector centre from the built-in table (approximate)
 *   city        the city centre (approximate)
 *   coordinates typed coordinates, used exactly
 *   none        nothing recognisable; the note says exactly what to add
 *
 * Sources: OpenStreetMap (Nominatim, limited to 1 request per second as its policy requires)
 * and Photon (komoot, an OpenStreetMap-based geocoder that handles names and misspellings).
 * Server-only.
 */
import { CITY_CENTERS } from "@/lib/roadNetwork";
import { GANDHINAGAR_SECTORS } from "@/lib/gandhinagarSectors";

export type MatchKind = "coordinates" | "exact" | "candidates" | "locality" | "sector" | "city" | "none";

export type LocationResult = {
  lat: number;
  lng: number;
  label: string;
  source: "coordinates" | "openstreetmap" | "photon" | "gazetteer";
  /** True when this is the nearest known place, not the building itself. */
  approximate?: boolean;
};

export type SearchOutcome = {
  results: LocationResult[];
  note: string | null;
  match: MatchKind;
};

const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const BUDGET_MS = 16000;
const NOMINATIM_GAP_MS = 1100;
const USER_AGENT = "JeevanSetu/1.0 (emergency routing; contact admin@jeevansetu.in)";
const cache = new Map<string, { at: number; value: SearchOutcome }>();

/** Cities and towns recognised in a query (canonical spelling). */
const KNOWN_CITIES = [
  "Gandhinagar", "Ahmedabad", "Vadodara", "Surat", "Rajkot", "Bhavnagar", "Jamnagar", "Anand", "Nadiad",
  "Mehsana", "Bharuch", "Junagadh", "Gandhidham", "Morbi", "Bhuj", "Vapi", "Navsari", "Valsad", "Patan",
  "Porbandar", "Godhra", "Palanpur", "Amreli", "Himmatnagar", "Bardoli", "Dahod", "Botad", "Ankleshwar",
  "Sanand", "Dholka", "Kadi", "Visnagar", "Khambhat", "Kalol", "Halol", "Dholera",
];

/** Spellings people commonly use for a city, mapped to the canonical name. */
const CITY_ALIASES: Record<string, string> = {
  amdavad: "Ahmedabad",
  ahmadabad: "Ahmedabad",
  ahemdabad: "Ahmedabad",
  ahmedabd: "Ahmedabad",
  baroda: "Vadodara",
  gandhidam: "Gandhidham",
  gandhinagr: "Gandhinagar",
  gandhingar: "Gandhinagar",
  gandhinager: "Gandhinagar",
};

/**
 * Well-known localities (societies, villages, areas) and the city each belongs to. Used to correct
 * misspelled area names and to infer the city when only a locality is typed. Localities that are
 * not in the map data still resolve to their city or sector.
 */
const KNOWN_AREAS: Record<string, string> = {
  Pathikashram: "Gandhinagar", Sargasan: "Gandhinagar", Kudasan: "Gandhinagar", Infocity: "Gandhinagar",
  Raysan: "Gandhinagar", Koba: "Gandhinagar", Adalaj: "Gandhinagar", Indroda: "Gandhinagar", Vavol: "Gandhinagar",
  Lavad: "Gandhinagar", Nilakunj: "Gandhinagar", Panchsheel: "Gandhinagar", Vijaynagar: "Gandhinagar",
  Ranchodnagar: "Ahmedabad", Sabarmati: "Ahmedabad", Chandkheda: "Ahmedabad", Motera: "Ahmedabad",
  Maninagar: "Ahmedabad", Navrangpura: "Ahmedabad", Vastrapur: "Ahmedabad", Satellite: "Ahmedabad",
  Bopal: "Ahmedabad", Thaltej: "Ahmedabad", Bodakdev: "Ahmedabad", Paldi: "Ahmedabad", Naranpura: "Ahmedabad",
  Ghatlodia: "Ahmedabad", Gota: "Ahmedabad", Nikol: "Ahmedabad", Naroda: "Ahmedabad", Vastral: "Ahmedabad",
  Odhav: "Ahmedabad", Isanpur: "Ahmedabad", Ambawadi: "Ahmedabad", Ellisbridge: "Ahmedabad",
  Shahibaug: "Ahmedabad", Usmanpura: "Ahmedabad", Prahladnagar: "Ahmedabad", Prahlad: "Ahmedabad",
  Sarkhej: "Ahmedabad", Juhapura: "Ahmedabad", Bapunagar: "Ahmedabad", Ranip: "Ahmedabad",
  Alkapuri: "Vadodara", Gotri: "Vadodara", Manjalpur: "Vadodara", Karelibaug: "Vadodara",
  Adajan: "Surat", Vesu: "Surat", Piplod: "Surat", Udhna: "Surat", Athwa: "Surat",
};

/** Words that describe a place without naming it. They are not required in a match. */
const FILLER = new Set([
  "near", "opp", "opposite", "behind", "beside", "next", "road", "rd", "street", "st", "highway", "hwy",
  "society", "soc", "flat", "flats", "apartment", "apt", "plot", "house", "no", "block", "phase", "floor",
  "tower", "bungalow", "bunglow", "building", "bldg", "gujarat", "india", "pin", "pincode", "lane", "cross",
  "circle", "chowk", "marg", "area", "township", "colony",
]);

// ---------- text utilities ----------

function levenshtein(a: string, b: string): number {
  const rows = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = rows[0];
    rows[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = rows[j];
      rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return rows[b.length];
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** A city the user typed, corrected for spelling (only for words long enough to be unambiguous). */
function cityFor(token: string): string | null {
  if (CITY_ALIASES[token]) return CITY_ALIASES[token];
  const exact = KNOWN_CITIES.find((c) => c.toLowerCase() === token);
  if (exact) return exact;
  if (token.length < 6) return null;
  let best: { name: string; distance: number } | null = null;
  for (const name of KNOWN_CITIES) {
    const distance = levenshtein(token, name.toLowerCase());
    if (distance <= (name.length >= 8 ? 2 : 1) && (!best || distance < best.distance)) best = { name, distance };
  }
  return best?.name ?? null;
}

/** A locality the user typed, corrected to the closest known name (for words of 7+ letters). */
function localityFor(token: string): string | null {
  const exact = Object.keys(KNOWN_AREAS).find((name) => name.toLowerCase() === token);
  if (exact) return exact;
  if (token.length < 7) return null;
  let best: { name: string; distance: number } | null = null;
  for (const name of Object.keys(KNOWN_AREAS)) {
    const distance = levenshtein(token, name.toLowerCase());
    if (distance <= 2 && (!best || distance < best.distance)) best = { name, distance };
  }
  return best?.name ?? null;
}

export type ParsedQuery = {
  /** Words that name the building, society, landmark or area; every one must match a result. */
  nameWords: string[];
  /** Localities recognised in the query (corrected name and its city). */
  localities: { name: string; city: string }[];
  city: string | null;
  sector: number | null;
  /** The query as it will be searched: numbers removed, city and locality spellings corrected. */
  cleaned: string;
  corrected: boolean;
};

/** Reads a typed address: finds the sector, city, localities and the words that name the place. */
export function parseQuery(raw: string): ParsedQuery {
  let text = raw.toLowerCase().replace(/gandhi\s+nagar/g, "gandhinagar");
  let sector: number | null = null;
  const sectorMatch = /\b(?:sector|sec)\.?\s*-?\s*(\d{1,2})[a-z]?\b/.exec(text);
  if (sectorMatch) {
    sector = Number(sectorMatch[1]);
    text = text.replace(sectorMatch[0], " ");
  }

  let city: string | null = null;
  let corrected = false;
  const nameWords: string[] = [];
  const localities: { name: string; city: string }[] = [];
  for (const token of words(text)) {
    if (/\d/.test(token)) continue; // house, plot, flat and pin-code numbers
    if (token === "sector" || token === "sec") continue;
    const canonicalCity = cityFor(token);
    if (canonicalCity) {
      if (canonicalCity.toLowerCase() !== token) corrected = true;
      city = canonicalCity;
      continue;
    }
    if (FILLER.has(token) || token.length < 3) continue;
    const locality = localityFor(token);
    if (locality) {
      if (locality.toLowerCase() !== token) corrected = true;
      const word = locality.toLowerCase();
      nameWords.push(word);
      if (!localities.some((l) => l.name === locality)) localities.push({ name: locality, city: KNOWN_AREAS[locality] });
      continue;
    }
    nameWords.push(token);
  }

  // A recognised locality tells us the city when the city was not typed.
  if (!city) city = localities.find((l) => l.city)?.city ?? null;
  // Sector numbers only mean something inside Gandhinagar; the sector table is used for that city.

  const cleanedParts = [...nameWords];
  if (city) cleanedParts.push(city.toLowerCase());
  if (sector !== null) cleanedParts.push(`sector ${sector}`);
  return {
    nameWords: [...new Set(nameWords)],
    localities,
    city,
    sector,
    cleaned: cleanedParts.join(" "),
    corrected,
  };
}

/** Parses "lat, lng" typed by the user. Returns null when the text is not a coordinate pair. */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const match = COORD.exec(text.trim());
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  // Gujarat is north of the equator and east of 60°E: accept "lat, lng" first, then "lng, lat".
  if (a >= 8 && a <= 35 && b >= 60 && b <= 100) return { lat: a, lng: b };
  if (b >= 8 && b <= 35 && a >= 60 && a <= 100) return { lat: b, lng: a };
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lng: b };
  return null;
}

// ---------- matching ----------

/** A query word matches a label word when equal, or (for long words) within two letters. */
function wordMatches(word: string, labelWords: string[]): boolean {
  if (labelWords.includes(word)) return true;
  if (word.length < 7) return false;
  return labelWords.some((w) => w.length >= 6 && levenshtein(word, w) <= 2);
}

function sectorOf(labelWords: string[]): number | null {
  const index = labelWords.indexOf("sector");
  if (index < 0 || index + 1 >= labelWords.length) return null;
  const value = Number(labelWords[index + 1]);
  return Number.isFinite(value) ? value : null;
}

function otherCityIn(labelWords: string[], city: string | null): string | null {
  for (const known of KNOWN_CITIES) {
    if (known === city) continue;
    if (labelWords.includes(known.toLowerCase())) return known;
  }
  return null;
}

/** Does this place name every word the patient typed (and not a different sector or city)? */
function isExact(result: LocationResult, query: ParsedQuery): boolean {
  if (query.nameWords.length === 0) return false;
  const labelWords = words(result.label);
  if (!query.nameWords.every((word) => wordMatches(word, labelWords))) return false;
  if (query.sector !== null) {
    const found = sectorOf(labelWords);
    if (found !== null && found !== query.sector) return false;
  }
  // A place that names a different city is rejected, unless it also names the city typed
  // (for example "Gandhinagar-Ahmedabad Highway" is a valid Ahmedabad address).
  if (query.city && otherCityIn(labelWords, query.city) && !labelWords.includes(query.city.toLowerCase())) return false;
  return true;
}

// ---------- providers ----------

let nominatimNextAt = 0;
async function waitForNominatimSlot(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nominatimNextAt);
  nominatimNextAt = start + NOMINATIM_GAP_MS;
  if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
}

async function fetchJson(url: string, attempts: number): Promise<unknown | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(7000),
        cache: "no-store",
      });
      if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        continue;
      }
      if (!response.ok) return null;
      return await response.json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  return null;
}

async function nominatim(query: string): Promise<LocationResult[]> {
  await waitForNominatimSlot();
  const q = /india|gujarat/i.test(query) ? query : `${query}, Gujarat, India`;
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in" +
    "&viewbox=68.1,24.7,74.5,20.1&q=" + encodeURIComponent(q);
  const rows = (await fetchJson(url, 2)) as { lat: string; lon: string; display_name: string }[] | null;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({ lat: Number(row.lat), lng: Number(row.lon), label: row.display_name, source: "openstreetmap" as const }))
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
}

async function photon(query: string, bias: { lat: number; lng: number }): Promise<LocationResult[]> {
  const url =
    "https://photon.komoot.io/api/?limit=6&lang=en" +
    `&lat=${bias.lat}&lon=${bias.lng}&q=` + encodeURIComponent(query);
  const data = (await fetchJson(url, 2)) as {
    features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[];
  } | null;
  if (!data?.features) return [];
  const out: LocationResult[] = [];
  for (const feature of data.features) {
    const p = feature.properties;
    if (p.country && p.country !== "India") continue;
    if (p.state && !/gujarat/i.test(p.state)) continue;
    const [lng, lat] = feature.geometry.coordinates;
    const parts = [p.name, p.street, p.locality, p.district, p.city, p.state].filter(Boolean) as string[];
    const label = [...new Set(parts)].join(", ");
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ lat, lng, label, source: "photon" });
  }
  return out;
}

/** Both providers for one query, never throwing. */
async function ask(query: string, bias: { lat: number; lng: number }, startedAt: number): Promise<LocationResult[]> {
  if (Date.now() - startedAt > BUDGET_MS) return [];
  const [fromNominatim, fromPhoton] = await Promise.all([
    nominatim(query).catch(() => [] as LocationResult[]),
    photon(query, bias).catch(() => [] as LocationResult[]),
  ]);
  return [...fromNominatim, ...fromPhoton];
}

// ---------- the search ----------

function biasFor(city: string | null): { lat: number; lng: number } {
  const centre = city ? CITY_CENTERS[city] : null;
  return centre ?? { lat: 23.0, lng: 72.6 };
}

function dedupe(results: LocationResult[]): LocationResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shown(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
}

/** Finds a pickup location for what the patient typed. Always returns a clear outcome. */
export async function searchLocation(raw: string): Promise<SearchOutcome> {
  const text = raw.trim().slice(0, 200);
  if (text.length < 2) return { results: [], note: "Type at least two characters.", match: "none" };

  const coords = parseCoordinates(text);
  if (coords) {
    return {
      results: [{ lat: coords.lat, lng: coords.lng, label: `Coordinates ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, source: "coordinates" }],
      note: null,
      match: "coordinates",
    };
  }

  const key = text.toLowerCase().replace(/\s+/g, " ");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const startedAt = Date.now();
  const query = parseQuery(text);
  const building = shown(text);
  const bias = biasFor(query.city);
  const finish = (outcome: SearchOutcome): SearchOutcome => {
    if (outcome.match !== "none") cache.set(key, { at: Date.now(), value: outcome });
    return outcome;
  };
  const notMapped = (where: string) =>
    `“${building}” is not in the map data. Showing ${where} — tap the map to place the pin on your building.`;

  // 1. The building, society or landmark itself.
  if (query.nameWords.length > 0) {
    const searches = [...new Set([query.cleaned, [...query.nameWords, query.city ?? ""].join(" ").trim()])].filter(Boolean);
    for (const search of searches) {
      const candidates = await ask(search, bias, startedAt);
      const matches = dedupe(candidates.filter((candidate) => isExact(candidate, query)));
      if (matches.length > 0 && query.city) {
        // The city (or a recognised locality) is known, so the first match is the place.
        return finish({
          results: [matches[0]],
          note: query.corrected ? `Searched as “${query.cleaned}”. Check the pin on the map.` : null,
          match: "exact",
        });
      }
      if (matches.length > 0) {
        // No city typed: several places in Gujarat may share this name, so the patient chooses.
        return finish({
          results: matches.slice(0, 4),
          note: `${matches.length === 1 ? "One place" : `${Math.min(matches.length, 4)} places`} named like “${building}” ${matches.length === 1 ? "was" : "were"} found. Check the city shown and pick the right one — or add the city to search more precisely.`,
          match: "candidates",
        });
      }
    }
  }

  // 2. A named locality (society, area) in its city — the closest mapped place for it.
  for (const locality of query.localities.slice(0, 3)) {
    const candidates = await ask(`${locality.name} ${locality.city}`, biasFor(locality.city), startedAt);
    const near = candidates.find((candidate) => {
      const labelWords = words(candidate.label);
      if (!wordMatches(locality.name.toLowerCase(), labelWords)) return false;
      const found = sectorOf(labelWords);
      return !(query.sector !== null && found !== null && found !== query.sector);
    });
    if (near) {
      const approximate = { ...near, approximate: true };
      return finish({ results: [approximate], note: notMapped(`${approximate.label.split(",").slice(0, 2).join(",")}`), match: "locality" });
    }
  }

  // 3. The sector centre (Gandhinagar table: instant, no network).
  if (query.sector !== null && query.city === "Gandhinagar" && GANDHINAGAR_SECTORS[query.sector]) {
    const centre = GANDHINAGAR_SECTORS[query.sector];
    const place: LocationResult = {
      lat: centre.lat,
      lng: centre.lng,
      label: `Sector ${query.sector}, Gandhinagar`,
      source: "gazetteer",
      approximate: true,
    };
    return finish({ results: [place], note: notMapped(`the centre of ${place.label}`), match: "sector" });
  }

  // 4. The city centre.
  if (query.city) {
    const centre = CITY_CENTERS[query.city];
    let place: LocationResult | null = null;
    if (centre) {
      place = { lat: centre.lat, lng: centre.lng, label: `${query.city} city centre`, source: "gazetteer", approximate: true };
    } else {
      const candidates = await ask(`${query.city}, Gujarat, India`, bias, startedAt);
      const found = candidates.find((c) => words(c.label).includes(query.city!.toLowerCase()));
      if (found) place = { lat: found.lat, lng: found.lng, label: `${query.city} city centre`, source: found.source, approximate: true };
    }
    if (place) return finish({ results: [place], note: notMapped(`the centre of ${query.city}`), match: "city" });
  }

  // 5. Nothing recognisable: say exactly what would help.
  const hint = query.city
    ? `Add the area or landmark, for example “${query.nameWords[0] ?? "Sanskar Bhavan"}, ${query.city}”.`
    : "Add the city or area, for example “" + shown(text) + ", Ahmedabad”.";
  return {
    results: [],
    note: `“${building}” is not in the map data and no area or city was recognised. ${hint} You can also tap the map to drop the pin.`,
    match: "none",
  };
}
