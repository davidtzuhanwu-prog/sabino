/**
 * relevance.ts
 * ─────────────
 * Frontend mirror of audience_service.py classify_tier().
 *
 * Given a stored `audience` string (e.g. "KHe,KH" or "Lower School") and the
 * parent's configured child class code (e.g. "KHe"), returns a RelevanceTier.
 *
 * Tiers in priority order:
 *   mine         – directly about the child's own class
 *   grade        – same grade (sibling class or grade-level grouping like TK&K)
 *   lower_school – all of Lower School
 *   whole_school – entire school (BIF-wide)
 *   upper_school – Upper / Middle school only → not relevant for a K–5 parent
 *   unknown      – no group header found (HTML newsletter, direct message)
 */

export type RelevanceTier =
  | 'mine'
  | 'grade'
  | 'lower_school'
  | 'whole_school'
  | 'upper_school'
  | 'unknown'

/** Visual metadata for each tier */
export const TIER_META: Record<RelevanceTier, {
  label: string
  badgeColor: string
  badgeBg: string
  dotOpacity: number
  priority: number          // lower = shown first in sorted lists
}> = {
  mine:         { label: '📌 Your class',   badgeColor: '#7a3318', badgeBg: '#fde8d8', dotOpacity: 1,    priority: 0 },
  grade:        { label: '👶 Your grade',   badgeColor: '#15803d', badgeBg: '#dcfce7', dotOpacity: 1,    priority: 1 },
  lower_school: { label: '🏫 Lower School', badgeColor: '#1d4ed8', badgeBg: '#dbeafe', dotOpacity: 0.85, priority: 2 },
  whole_school: { label: '🌐 All school',   badgeColor: '#6b21a8', badgeBg: '#f3e8ff', dotOpacity: 0.7,  priority: 3 },
  upper_school: { label: '🔇 Other grade',  badgeColor: '#6b7280', badgeBg: '#f3f4f6', dotOpacity: 0.3,  priority: 4 },
  unknown:      { label: '',                badgeColor: '#94a3b8', badgeBg: '#f8fafc', dotOpacity: 0.6,  priority: 3 },
}

/**
 * Derive the grade prefix from a class code.
 *   "KHe" → "k"
 *   "KH"  → "k"
 *   "TKO" → "tk"
 *   "1C"  → "1"
 *   "2Ar" → "2"
 */
function gradePrefix(code: string): string {
  const lower = code.toLowerCase()
  if (lower.startsWith('tk')) return 'tk'
  if (lower.startsWith('k')) return 'k'
  const digit = lower.match(/^([1-5])/)
  return digit ? digit[1] : ''
}

/**
 * Score the relevance of a single email's audience string against the
 * configured child class code.
 *
 * @param audience   Value of Email.audience from the backend (may be null/empty)
 * @param childCode  The parent's configured class code, e.g. "KHe"
 */
export function scoreRelevance(
  audience: string | null | undefined,
  childCode: string,
): RelevanceTier {
  if (!audience) return 'unknown'

  const a = audience.toLowerCase()
  const code = childCode.trim().toLowerCase()

  if (!code) {
    // No child class configured — still classify broad tiers
    if (a.includes('upper school') || a.includes('middle school')) return 'upper_school'
    if (a.includes('lower school')) return 'lower_school'
    if (a.includes('basis independent fremont')) return 'whole_school'
    return 'unknown'
  }

  const prefix = gradePrefix(code)

  // ── 1. Direct class match ─────────────────────────────────────────────────
  // The child's code appears as a token in the audience string
  if (new RegExp(`\\b${escapeRe(code)}\\b`, 'i').test(a)) return 'mine'

  // ── 2. Upper school → always irrelevant ───────────────────────────────────
  if (/\b(upper school|middle school|high school|grade [6-9]|grade 1[0-2]|6th|7th|8th|9th|10th|11th|12th)\b/i.test(a)) {
    return 'upper_school'
  }

  // ── 3. Same-grade groupings ───────────────────────────────────────────────
  if (prefix === 'k') {
    // Sibling kindergarten class or generic kindergarten mention
    if (/\b(khe|kh|kindergarten)\b/i.test(a)) return 'grade'
    // TK&K grouping (both TK and K appear together)
    if (a.includes('tk') && (a.includes(',k') || a.includes('kindergarten'))) return 'grade'
  } else if (prefix === 'tk') {
    if (/\b(tko|tku|transitional.?kindergarten)\b/i.test(a)) return 'grade'
    if (a.includes('tk') && (a.includes(',k') || a.includes('kindergarten'))) return 'grade'
  } else if (prefix && /^[1-5]$/.test(prefix)) {
    // Another section of the same numeric grade, e.g. child is in "1C", audience is "1N"
    if (new RegExp(`\\b${prefix}[a-z]`, 'i').test(a)) return 'grade'
  }

  // ── 4. Lower school ───────────────────────────────────────────────────────
  if (a.includes('lower school')) return 'lower_school'

  // ── 5. Whole school ───────────────────────────────────────────────────────
  if (a.includes('basis independent fremont')) return 'whole_school'

  return 'unknown'
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether a tier should be shown prominently (not collapsed).
 * upper_school items are collapsed by default for a K–5 parent.
 */
export function isRelevant(tier: RelevanceTier): boolean {
  return tier !== 'upper_school'
}

/**
 * Sort comparator: higher-priority (more relevant) tiers sort first.
 */
export function compareTier(a: RelevanceTier, b: RelevanceTier): number {
  return TIER_META[a].priority - TIER_META[b].priority
}
