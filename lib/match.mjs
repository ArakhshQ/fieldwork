/** Platinum: every word is in the title. Gold: every word matches. Silver: a partial match. */
export function matchGrade(total, hits, inTitle) {
  if (!total) return null;
  if (inTitle === total) return 'platinum';
  return hits === total ? 'gold' : 'silver';
}
