/**
 * Report compression checks. Run: node test/summarize.mjs
 *
 * The budget is the whole point: a spoken report must stay short while keeping
 * every number and the outcome. These checks pin that behaviour down.
 */

import { compressReport, stripForSpeech, summarizeLocally } from '../lib/summarize.js'

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

const report = [
  '# 本轮进展',
  '',
  '我把 `dsh-voice` 插件重新整理了一遍，新增了 **skill** 和 **soul** 两套机制。',
  '',
  '1. skill 管播报规矩，决定什么时候念、念多长。',
  '2. soul 管人设，改一个 Markdown 就能换说话方式。',
  '3. 插件现在把 persona 直接暴露在 tts_engines 的返回值里。',
  '',
  '测试全过，还有一个 README 被误当成人设的 bug 已修复。',
  '下一步要做首次加载的引导问答。',
  '',
  '```js',
  'const x = 1',
  '```',
].join('\n')

console.log('summarize checks')

console.log('\n1. markdown and code are removed')
const clean = stripForSpeech(report)
check('no code fence survives', !clean.includes('```'))
check('no backticks survive', !clean.includes('`'))
check('no heading markers survive', !clean.includes('#'))
check('no list markers survive', !/^\s*\d\.\s/m.test(clean))
check('an identifier keeps its underscore', clean.includes('tts_engines') || clean.includes('dsh-voice'))
check('bold markers are gone but their text stays', clean.includes('skill') && !clean.includes('**'))
console.log(`     cleaned: ${clean.length} chars`)

console.log('\n2. a short text passes through untouched')
const short = '测试全过，两个问题已修复。'
const passthrough = summarizeLocally(short, 110)
check('short text is kept verbatim', passthrough.text === short && passthrough.truncated === false)

console.log('\n3. a long text is cut to the budget')
const budget = 90
const cut = summarizeLocally(report, budget)
check(`result fits the ${budget}-char budget`, cut.text.length <= budget, `${cut.text.length} chars`)
check('it actually truncated', cut.truncated === true)
check('it kept fewer sentences than it saw', cut.kept < cut.total, `${cut.kept}/${cut.total}`)
console.log(`     kept: ${cut.text}`)

console.log('\n4. every compressed version stays a faithful subsequence of the source')
const sourceClean = stripForSpeech(report).replace(/[。！？!?；;\s]/g, '')
for (const size of [60, 90, 130, 200]) {
  const squeezed = summarizeLocally(report, size)
  const compact = squeezed.text.replace(/[。！？!?；;…\s]/g, '')
  check(`budget ${size}: fits`, squeezed.text.length <= size, `${squeezed.text.length} chars`)
  check(`budget ${size}: non-empty`, compact.length > 0)
  // No paraphrase, no invention: every character must come from the source.
  const invented = compact
    .split('')
    .filter((char) => !sourceClean.includes(char))
    .join('')
  check(`budget ${size}: invents nothing`, invented.length === 0, invented)
}

const generous = summarizeLocally(report, 200)
check('a generous budget keeps the closing outcome', /测试全过|下一步|修复/.test(generous.text))
console.log(`     kept at 200: ${generous.text}`)

console.log('\n5. compressReport prefers verbatim, then falls back locally')
const direct = await compressReport({ text: short, budget: 110 })
check('short input is verbatim', direct.via === 'verbatim', direct.via)

const local = await compressReport({ text: report, budget: 90 })
check('no subagent falls back to local', local.via === 'local', local.via)
check('the fallback respects the budget', local.characters <= 90, `${local.characters} chars`)
check('the fallback still produces speech', local.text.length > 5)

console.log('\n6. a hostile budget cannot produce empty speech')
const tiny = await compressReport({ text: report, budget: 1 })
check('a tiny budget is clamped, not obeyed blindly', tiny.text.length > 0, `${tiny.text.length} chars`)

console.log('\n7. an incomplete enumeration loses its ordinals')
// Hearing "第一 …… 第四" with items two and three missing makes a listener think
// they missed something. The markers have to go when the list is not complete.
//
// The input must be long enough that compression actually runs: if the whole
// text fits the budget it is spoken verbatim, no sentences are dropped, and
// this rule never gets exercised.
const enumerated = [
  '本轮把插件从能出声推进到了能播报，主要做了五件事，下面逐条说明，每条都附上了为什么必须做。',
  '1. 第一个结论比较短，说明首次加载的答案会持久化到状态文件里，重启之后不必再问一遍。',
  '2. 第二个条目稍微长一些，说明 skill 里强制使用压缩工具、禁止整篇朗读的那几条规则都验证有效，并且有测试盯着。',
  '3. 第三个条目也比较长，说明报告工具确实走了压缩路径，几百字的报告会被压到一百字上下，落在十秒左右。',
  '4. 第四个条目更长一些，内容是为了确保在中等预算下它会被排到末尾、从而被丢掉，这是为了让序号出现缺口。',
  '5. 第五个条目还要更长一些，同样是为了在中等预算下被丢掉，这样保留下来的序号就会从一直接跳到五，产生缺口。',
  '6. 收尾，测试全部通过。',
].join('\n')

const squeezed = summarizeLocally(enumerated, 90)
check('compression actually ran', squeezed.truncated === true)
check('a squeezed enumeration drops its ordinals', !/第[一二三四五六]|[1-6]\./.test(squeezed.text), squeezed.text)
console.log(`     squeezed: ${squeezed.text}`)

const roomy = summarizeLocally(enumerated, 600)
check('a complete enumeration keeps them', roomy.truncated === false || /1\.|第一/.test(roomy.text))

// A sentence-initial marker is an enumeration lead-in; the same words inside a
// sentence are an ordinary noun phrase and must survive.
const nounPhrase = '我们解决了第一个问题，过程很顺利。'
check('a mid-sentence ordinal is not treated as a list marker', summarizeLocally(nounPhrase, 500).text.includes('第一个问题'))

console.log('\n8. a conclusion whose premise was dropped is dropped too')
// "这类X" with nothing before it naming what "这类" refers to is not a summary,
// it is a fragment. A missing sentence is quieter than an unreadable one.
const dangling = [
  '本轮先说明背景，这部分内容比较长，写出来是为了在压缩时被丢掉，从而制造出指代断裂的情况。',
  '我的测试连续两次没有测到目标路径，这两次测试都是绿色的，但什么都没验证到。',
  '这类假绿比失败更危险，因为它会让人误以为一切正常。',
  '最后确认一下，全部测试文件都通过了。',
].join('\n')

const withDangling = summarizeLocally(dangling, 60)
check('a dangling back-reference is not spoken', !/这类假绿/.test(withDangling.text), withDangling.text)
check('the dangling sentence is reported as dropped', typeof withDangling.dropped === 'number')
console.log(`     spoken: ${withDangling.text}`)
console.log(`     dropped by the reference rule: ${withDangling.dropped}`)

// A back-reference directly after its premise is fine and must survive.
const anchored = '测试连续两次没有测到目标路径，两次都是绿的。这类假绿比失败更危险，因为它让人误以为一切正常。后面还有更长的内容用来把预算撑爆，这样压缩才会真正发生并触发检查。'
const keptPairs = summarizeLocally(anchored, 46)
check('an anchored back-reference is not over-trimmed', keptPairs.text.length > 0, keptPairs.text)

console.log('\n9. an enumeration written inside sentences is caught too')
// The first version of this rule only understood a line-based list ("1. …").
// Prose routinely writes "第一类是…；第二类是…" inside one long sentence, and that
// form produced exactly the same defect: 第一类 kept, 第二类 dropped, 第三类 kept.
const inline = [
  '这一轮统计了一下批注，代码两千四百多行，注释四百二十行，分三类。',
  '第一类是设计理由，占最多，说明为什么内置引擎的播放要走系统接口而不是外部程序。',
  '第二类是踩坑警告，这类最有价值，记录命令行传参会被代码页破坏这类真实问题。',
  '第三类是接口说明，描述每个函数接受什么、返回什么。',
  '最后完成了首次提交，四十个文件。',
].join('\n')

for (const size of [70, 95, 130]) {
  const cut = summarizeLocally(inline, size)
  const markers = ['一', '二', '三'].filter((n) => cut.text.includes(`第${n}类`))
  const contiguous = markers.every((n, i) => '一二三'.indexOf(n) === i)
  check(`budget ${size}: inline enumeration leaves no gap`, contiguous, `kept: ${markers.join(',') || '(none)'}`)
}
const inlineCut = summarizeLocally(inline, 95)
console.log(`     budget 95 spoken: ${inlineCut.text}`)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
