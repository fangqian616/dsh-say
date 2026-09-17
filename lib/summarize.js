/**
 * Keep a spoken report short.
 *
 * Speech is linear: 150 characters of Chinese is already ~25 seconds of audio,
 * and listening to a full written report is worse than reading it. So a report
 * meant for the speakers is compressed to a character budget first.
 *
 * Two strategies, in order of preference:
 *
 *   1. `compressWithSubagent` — a child agent rewrites the report to fit, which
 *      knows what matters in ways no heuristic can.
 *   2. `summarizeLocally` — dependency-free sentence ranking, used when no
 *      subagent is available (a bare composition, a depth-limited session) so
 *      the tool still works.
 *
 * @module dsh-voice/lib/summarize
 */

/**
 * Sentence-level split that keeps the terminator with its sentence.
 *
 * A numbered list marker must break *before* the number, not after: splitting
 * the other way leaves a bare "1" as its own sentence, which then reads aloud
 * as a stray digit or gets dropped with the number it belonged to.
 */
function splitSentences(text) {
  const parts = String(text)
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?；;])|(?=\d+\.[ \t])|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return parts.length > 0 ? parts : [String(text).trim()]
}

/** Remove a leading list marker from one sentence, keeping the content. */
function dropListMarker(sentence) {
  return sentence.replace(/^(?:\d+\.|[-*+])[ \t]*/, '').trim()
}

/** Join sentences with a single terminator each, so speech gets natural pauses. */
function joinSentences(sentences) {
  return sentences
    .map((sentence) => sentence.replace(/。+$/, '').trim())
    .filter((sentence) => sentence.length > 0)
    .map((sentence) => (/[。！？!?；;]$/.test(sentence) ? sentence : `${sentence}。`))
    .join('')
}
/** Signals that a sentence carries the outcome rather than the setup. */
const OUTCOME_HINTS = [
  'ok', 'done', 'fixed', 'passed', 'failed', 'error', 'next', 'todo',
  '完成', '通过', '失败', '结论', '结果', '已修复', '已删除', '下一步', '需要', '注意', '风险',
]

/** Writing that reads poorly aloud, so it is trimmed or dropped. */
const NOISE_PATTERNS = [
  [/```[\s\S]*?```/g, ' '],
  // Backticks mark a code span: drop the backticks, keep the identifier. The
  // identifier itself may contain underscores, which must survive.
  [/`([^`]*)`/g, '$1'],
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'],
  // A list marker must become a sentence break, not vanish: without the break,
  // "进展" and the first item run together and the narration is unintelligible.
  [/^[ \t]*[-*+][ \t]+/gm, '。'],
  [/^[ \t]*\d+\.[ \t]+/gm, '。'],
  [/^[ \t]*#{1,6}[ \t]*/gm, ''],
  [/^[ \t]*>[ \t]?/gm, ''],
  // Emphasis markers only when they actually wrap text; a lone `_` inside an
  // identifier is part of the name, not formatting.
  [/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2'],
  [/(?<=\s|^)[*_](?=\S)([^*_\n]*?\S)[*_](?=\s|$|[。！？，,.;；])/g, '$1'],
  [/\*/g, ''],
]

/** Strip Markdown and code so the result can be read by a voice. */
export function stripForSpeech(text) {
  let out = String(text)
  for (const [pattern, replacement] of NOISE_PATTERNS) out = out.replace(pattern, replacement)
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/。{2,}/g, '。')
    .replace(/\n{2,}/g, '\n')
    .replace(/^[。\s]+/, '')
    .trim()
}

/**
 * A speech-ready rendering of one short text: the source, normalized.
 *
 * The verbatim path uses this too. Returning raw input would hand Markdown and
 * stray newlines to the synthesizer, which either reads the symbols aloud or
 * inserts pauses that make the narration sound broken.
 */
function normalizeForSpeech(text) {
  return String(text)
    .replace(/[ \t]*\n+[ \t]*/g, '')
    .replace(/。{2,}/g, '。')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[。\s]+/, '')
    .trim()
}

/**
 * Ordinal lead-ins a spoken enumeration can carry: `1.`, `第一，`, `第一个`.
 *
 * They are a problem after compression. Keeping items 1 and 4 while dropping 2
 * and 3 makes the narration claim a sequence it no longer contains — a listener
 * hears "第一 …… 第四" and concludes they missed something, or that the report
 * is broken. Renumbering is worse: it invents an order the author never wrote.
 *
 * The anchor matters. Only a marker at the START of a sentence is an
 * enumeration lead-in; the same words mid-sentence ("解决了第一个问题") are
 * ordinary noun phrases and must be left alone.
 */
const ORDINAL_PATTERN = /(^|[。！？!?；;\n])(?:[ \t]*\d+[.、)][ \t]*|[ \t]*第[一二三四五六七八九十百]+(?:个|[，,、.．)）:])?[ \t]*)/g

/** Remove only sentence-initial ordinal lead-ins, keeping the terminator. */
function removeOrdinals(text) {
  return String(text)
    .replace(ORDINAL_PATTERN, (_match, boundary) => boundary)
    // Inline enumerations ("第一类是…；第三类是…") carry the marker mid-sentence,
    // so the label has to go too, not just a lead-in.
    .replace(/第[一二三四五六七八九十]+(?:类|种|点|条|项|个|步|部分|方面|阶段|者)?[，,、是：:]?/g, '')
}

const CJK_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/**
 * Which enumeration number a sentence declares, anywhere inside it.
 *
 * Not only at the start: prose routinely writes "第一类是…；第二类是…" inside one
 * long sentence, so a start-anchored check misses the common case. Reading the
 * marker wherever it appears is what catches an enumeration that lost a member.
 */
function declaredNumbers(sentence) {
  const found = []
  const pattern = /第([一二三四五六七八九十]+)(?:类|种|点|条|项|个|步|部分|方面|阶段|者)?|(\d+)[.、)]/g
  let match
  while ((match = pattern.exec(sentence)) !== null) {
    if (match[1]) {
      const value = CJK_DIGITS[match[1]]
      if (value !== undefined) found.push(value)
      continue
    }
    if (match[2]) found.push(Number.parseInt(match[2], 10))
  }
  return found
}

/** A sentence that opens with a reference back to what came before. */const ANAPHORIC_OPENERS = [
  '这类', '这种', '这些', '这样', '这个', '这一', '此处', '该',
  '因此', '所以', '于是', '从而', '据此', '由此', '综上',
  '其', '此', '该问题', '上述', '前者', '后者', '同样', '反之',
]

/**
 * Drop a sentence that refers back to something no longer spoken.
 *
 * Local compression selects sentences independently, so it can keep a
 * conclusion whose premise was dropped: "这类假绿比失败更危险" with nothing
 * before it explaining what "这类" is. A listener hears an assertion with no
 * antecedent and cannot recover the meaning.
 *
 * The fix is not to keep the premise — the budget may not allow it — but to
 * drop the dangling reference too, because a missing sentence is quieter than
 * a sentence that cannot be understood. Sentences are removed until the
 * remaining ones are either adjacent in the source or free of a back-reference.
 *
 * @param {Array<{sentence: string, index: number}>} chosen kept sentences, in source order
 * @returns {Array<{sentence: string, index: number}>} the sentences worth speaking
 */
function dropDanglingReferences(chosen) {
  const kept = [...chosen]
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < kept.length; i += 1) {
      const current = kept[i]
      const opens = ANAPHORIC_OPENERS.some((opener) => current.sentence.trim().startsWith(opener))
      if (!opens) continue
      // A back-reference is satisfied when the previous spoken sentence is the
      // one that immediately preceded it in the source.
      const previous = i > 0 ? kept[i - 1] : undefined
      const adjacent = previous !== undefined && current.index === previous.index + 1
      if (adjacent) continue
      kept.splice(i, 1)
      changed = true
      break
    }
  }
  return kept
}

/**
 * Drop every ordinal lead-in when the kept sentences do not cover the whole
 * enumeration.
 *
 * Keeping items 1 and 4 while dropping 2 and 3 makes the narration claim a
 * sequence it no longer contains: a listener hears "第一 …… 第四" and concludes
 * they missed something, or that the report is broken. Renumbering is worse —
 * it invents an order the author never wrote.
 *
 * A complete prefix (`第一 第二 第三` with nothing missing) keeps its markers,
 * because then the enumeration is honest.
 */
function stripOrdinalsIfIncomplete(cleanText, numberedIndexes) {
  if (numberedIndexes.length < 2) return null
  const highest = Math.max(...numberedIndexes)
  const kept = new Set(numberedIndexes)
  for (let n = 1; n <= highest; n += 1) {
    if (!kept.has(n)) return removeOrdinals(cleanText)
  }
  return null
}
/**
 * Cut one over-long sentence down to fit, preferring a clause boundary.
 *
 * Sentence-level selection alone cannot honour a budget: a report whose sentences
 * are each 40-60 characters will always overshoot a 150-character budget, because
 * no whole sentence fits what is left. That is a real report shape, not an edge
 * case, so the budget has to be enforced here rather than merely aimed at.
 */
function clipToBudget(sentence, budget) {
  if (budget <= 1) return sentence.slice(0, Math.max(1, budget))
  if (sentence.length <= budget) return sentence
  const room = budget - 1
  const head = sentence.slice(0, room)
  // Prefer to end on a clause or phrase boundary rather than mid-word.
  const boundary = Math.max(
    head.lastIndexOf('，'),
    head.lastIndexOf('、'),
    head.lastIndexOf('；'),
    head.lastIndexOf(','),
    head.lastIndexOf(' '),
  )
  const cut = boundary >= Math.floor(room * 0.6) ? head.slice(0, boundary) : head
  return `${cut}…`
}

/**
 * Rank sentences and return the highest-value ones within `budget` characters,
 * kept in their original order so the result still reads as prose.
 *
 * @param {string} text
 * @param {number} budget characters
 * @returns {{ text: string, kept: number, total: number, truncated: boolean }}
 */
export function summarizeLocally(text, budget = 110) {
  const clean = stripForSpeech(text)
  if (clean.length <= budget) {
    return { text: normalizeForSpeech(clean), kept: 0, total: 0, truncated: false }
  }
  // Whether a sentence came from a numbered item must be recorded BEFORE the
  // marker is stripped, or the ranking can never see it.
  const raw = splitSentences(clean).map((sentence) => {
    const marker = /^(\d+)\./.exec(sentence.trim())
    return {
      sentence,
      numbered: marker !== null,
      number: marker ? Number.parseInt(marker[1], 10) : 0,
    }
  })
  const sentences = raw
    .map((entry, index) => ({ ...entry, index, sentence: dropListMarker(entry.sentence) }))
    .filter((entry) => entry.sentence.length > 0)

  const scored = sentences.map((entry, index) => {
    let score = 0
    // A numbered item is a finding the author chose to enumerate, so it
    // outranks ordinary prose — but the close still outranks everything,
    // because a spoken report that omits the outcome is useless.
    if (entry.numbered) score += 6
    else if (index === sentences.length - 1) score += 5
    else if (index === 0) score += 3
    const lower = entry.sentence.toLowerCase()
    if (OUTCOME_HINTS.some((hint) => lower.includes(hint))) score += 3
    if (/\d/.test(entry.sentence)) score += 2
    // Favour complete sentences; a very short fragment carries little on its own.
    if (entry.sentence.length >= 12) score += 1
    return { sentence: entry.sentence, index, score, number: entry.number }
  })

  const byValue = [...scored].sort((a, b) => b.score - a.score || a.index - b.index)
  const chosen = []
  let used = 0
  for (const candidate of byValue) {
    const size = candidate.sentence.length + 1
    if (used + size <= budget) {
      chosen.push(candidate)
      used += size
    }
  }
  if (chosen.length === 0) {
    // Nothing fits whole; take the head of the text so speech still happens.
    const head = clean.slice(0, Math.max(1, budget - 1))
    return { text: `${head}…`, kept: 1, total: sentences.length, truncated: true }
  }
  chosen.sort((a, b) => a.index - b.index)
  const speakable = dropDanglingReferences(chosen)
  const joined = joinSentences(speakable.map((entry) => entry.sentence))
  // An incomplete enumeration must not keep its markers, or the narration
  // claims a sequence it no longer contains. The numbers are read from the
  // sentences that survived, so an inline enumeration ("第一类是…") is caught
  // as well as a line-based list ("1. …").
  const keptNumbers = speakable.flatMap((entry) => [
    ...(entry.number > 0 ? [entry.number] : []),
    ...declaredNumbers(entry.sentence),
  ])
  const reconciled = stripOrdinalsIfIncomplete(clean, keptNumbers)
  let output = reconciled !== null ? normalizeForSpeech(reconciled) : joined
  // The budget is a promise, not a target. Whole-sentence selection can still
  // overshoot when the sentences are long, so the result is clipped to fit.
  if (output.length > budget) output = clipToBudget(output, budget)
  return {
    text: output,
    kept: speakable.length,
    dropped: chosen.length - speakable.length,
    total: sentences.length,
    truncated: true,
  }
}

/**
 * Compress by asking a child agent to rewrite the report for speech.
 *
 * Returns `undefined` when delegation is unavailable or fails, so the caller
 * falls back to the local summarizer instead of dropping the report.
 *
 * @param {object} options
 * @param {object} options.subagents the `subagents` service
 * @param {object} options.parent the calling Agent
 * @param {string} options.text the full report
 * @param {number} options.budget character budget for the spoken version
 * @param {string} [options.persona] behaviour notes the rewrite must follow
 * @param {AbortSignal} [options.signal]
 */
export async function compressWithSubagent(options) {
  const { subagents, parent, text, budget, persona, signal } = options
  if (!subagents || !parent) return undefined

  const names = typeof subagents.list === 'function' ? subagents.list() : []
  if (!Array.isArray(names) || names.length === 0) return undefined

  const instructions = [
    `Rewrite the report below as spoken narration, in at most ${budget} characters.`,
    'Keep every fact, number, and outcome exactly as stated. Do not add anything.',
    'Drop formatting, code, file paths, and pleasantries. Write it to be heard once, not re-read.',
    persona ? `Follow this behaviour note:\n${persona}` : '',
    '',
    'REPORT:',
    text,
  ].filter(Boolean).join('\n')

  let run
  try {
    run = await subagents.start(names[0], {
      label: 'dsh-voice report compression',
      prompt: [{ type: 'text', text: instructions }],
      parent,
      signal,
    })
  } catch {
    return undefined
  }

  try {
    const result = await run.result
    const blocks = Array.isArray(result?.output) ? result.output : []
    const spoken = blocks
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim()
    if (!spoken) return undefined
    return { text: stripForSpeech(spoken), via: 'subagent' }
  } catch {
    return undefined
  } finally {
    try {
      await run.dispose()
    } catch {
      /* the run already settled */
    }
  }
}

/**
 * Produce the text to speak for a report, preferring delegation and always
 * respecting the budget.
 *
 * @param {object} options see {@link compressWithSubagent}, plus `text`
 * @returns {Promise<{ text: string, via: 'verbatim'|'subagent'|'local', truncated: boolean, characters: number }>}
 */
export async function compressReport(options) {
  const budget = Math.max(40, Math.min(400, options.budget || 110))
  const source = String(options.text || '')
  const clean = stripForSpeech(source)

  if (clean.length <= budget) {
    return {
      text: summarizeLocally(source, budget).text,
      via: 'verbatim',
      truncated: false,
      characters: normalizeForSpeech(clean).length,
    }
  }

  const delegated = await compressWithSubagent({ ...options, budget })
  if (delegated && delegated.text.length > 0) {
    // A child that overshoots is trimmed locally rather than rejected.
    if (delegated.text.length <= budget) {
      return { text: delegated.text, via: 'subagent', truncated: true, characters: delegated.text.length }
    }
    const trimmed = summarizeLocally(delegated.text, budget)
    return { text: trimmed.text, via: 'subagent', truncated: true, characters: trimmed.text.length }
  }

  const local = summarizeLocally(source, budget)
  return { text: local.text, via: 'local', truncated: true, characters: local.text.length }
}
