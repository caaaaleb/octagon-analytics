// Shared fighter-name matching — used by both the odds sync (matching The
// Odds API's plain name strings) and the rankings sync (matching UFC.com's
// athlete names) against our `fighters` roster. Both external sources give
// us nothing but a name string, so resolution has to be a deterministic,
// conservative rule: exact match first, then a (first-token, last-token)
// variant match (catches suffix/full-legal-name mismatches, e.g. "Ian Garry"
// vs. our "Ian Machado Garry", or "Khalil Rountree" vs. "Khalil Rountree
// Jr."), then a last-name-only match (catches legal-name-vs-known-as
// mismatches, e.g. "Stephen Erceg" vs. our "Steve Erceg") — but only when
// each fallback tier resolves to exactly one candidate, so ambiguous names
// (or common surnames) correctly fall through to "unmatched" instead of
// guessing. Real name collisions (two different fighters sharing a full
// name, e.g. two UFC lightweights both named "Mike Davis") are resolved by
// preferring whoever has fought more, so repeated runs can't flip-flop
// between them.
//
// All comparisons run through normalizeName first: UFC.com's rankings use
// proper accented spelling ("Jiří Procházka", "Jéssica Andrade") and
// sometimes a space where our historical roster has a hyphen ("Waldo
// Cortes Acosta" vs. our "Waldo Cortes-Acosta"), while our roster (sourced
// from UFCStats) is plain ASCII — stripping diacritics and normalizing
// hyphens to spaces on both sides fixed 10 of 11 rankings-sync mismatches
// in practice, leaving only genuinely new-to-our-data fighters unmatched.
export type MatchableFighter = {
  id: string;
  full_name: string;
  wins: number;
  losses: number;
  draws: number;
  no_contests: number;
};

export type FighterMatch = { id: string; matchedVia: string };

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

// Most accented Latin letters (í, č, ń, é...) decompose via NFD into a
// plain base letter + a combining mark that can just be stripped. A few
// don't decompose at all — they're their own atomic code point — and need
// an explicit substitution instead (confirmed via testing: NFD-stripping
// alone left "Jan Błachowicz" unmatched against our roster's "Jan
// Blachowicz" until this table was added).
const NON_DECOMPOSING_LETTERS: Record<string, string> = {
  ł: "l",
  đ: "d",
  ø: "o",
  þ: "th",
  ð: "d",
  æ: "ae",
  œ: "oe",
  ß: "ss",
};
const NON_DECOMPOSING_PATTERN = new RegExp(Object.keys(NON_DECOMPOSING_LETTERS).join("|"), "g");

function normalizeName(fullName: string): string {
  return fullName
    .trim()
    .toLowerCase()
    .replace(NON_DECOMPOSING_PATTERN, (ch) => NON_DECOMPOSING_LETTERS[ch])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/-/g, " ");
}

function nameTokens(fullName: string): { first: string; last: string } {
  const parts = normalizeName(fullName).split(/\s+/);
  let last = parts[parts.length - 1];
  if (NAME_SUFFIXES.has(last) && parts.length > 1) {
    parts.pop();
    last = parts[parts.length - 1];
  }
  return { first: parts[0], last };
}

function totalFights(f: MatchableFighter): number {
  return f.wins + f.losses + f.draws + f.no_contests;
}

export function buildFighterMatcher(fighters: MatchableFighter[]): (name: string) => FighterMatch | null {
  const exactByName = new Map<string, MatchableFighter>();
  for (const f of fighters) {
    const key = normalizeName(f.full_name);
    const current = exactByName.get(key);
    if (!current || totalFights(f) > totalFights(current)) exactByName.set(key, f);
  }
  const byTokens = new Map<string, MatchableFighter[]>();
  const byLastName = new Map<string, MatchableFighter[]>();
  for (const f of fighters) {
    const { first, last } = nameTokens(f.full_name);
    const key = `${first}|${last}`;
    if (!byTokens.has(key)) byTokens.set(key, []);
    byTokens.get(key)!.push(f);
    if (!byLastName.has(last)) byLastName.set(last, []);
    byLastName.get(last)!.push(f);
  }

  return function resolveFighter(name: string): FighterMatch | null {
    const exact = exactByName.get(normalizeName(name));
    if (exact) return { id: exact.id, matchedVia: "exact" };

    const { first, last } = nameTokens(name);
    const candidates = byTokens.get(`${first}|${last}`) ?? [];
    if (candidates.length === 1) {
      return { id: candidates[0].id, matchedVia: `variant of "${candidates[0].full_name}"` };
    }

    const lastNameCandidates = byLastName.get(last) ?? [];
    if (lastNameCandidates.length === 1) {
      return { id: lastNameCandidates[0].id, matchedVia: `last-name match for "${lastNameCandidates[0].full_name}"` };
    }
    return null;
  };
}
