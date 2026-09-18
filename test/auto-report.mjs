/**
 * Auto-report wiring check. Run: node test/auto-report.mjs
 *
 * Verifies the pieces the skill relies on when a report should be spoken
 * automatically:
 *
 *   1. the onboarding answer maps to an auto-report decision,
 *   2. the skill mandates the compressing tool instead of full-length speech,
 *   3. the tool returns the metadata an agent needs to trust the result,
 *   4. speaking is skipped on request (noPlay), so this check stays silent.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const stateDir = mkdtempSync(join(tmpdir(), 'dsh-say-autoreport-'))
process.env.DSH_VOICE_STATE_DIR = stateDir

const { onboard, readState } = await import('../lib/onboarding.js')
const { report, readPersona } = await import('../lib/tools.js')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

const baseConfig = (overrides = {}) => ({
  engine: 'builtin',
  voicesDir: join(homedir(), '.dsh', 'voice-packs'),
  defaultVoice: '',
  defaultVoiceBuiltin: '',
  speed: 1,
  textLang: 'zh',
  promptLang: 'zh',
  sampleSteps: 32,
  reportBudget: 120,
  timeoutSeconds: 900,
  keepAudio: false,
  engines: { gptSovits: { serverUrl: '', engineRoot: '', python: '', version: 'v2ProPlus', device: 'cpu', isHalf: false } },
  ...overrides,
})

console.log('auto-report checks')

console.log('\n1. the onboarding answer decides automatic reporting')
const decided = await onboard({
  userQuestions: {
    ask: async () => ({
      answers: [
        { id: 'voice', selected: ['先用系统语音'], custom: '' },
        { id: 'soul', selected: ['用默认人设'], custom: '' },
        { id: 'report', selected: ['要，压缩后播报'], custom: '' },
      ],
    }),
  },
  agent: { id: 'test' },
})
check('auto-report is enabled by that answer', decided.autoReport === true)
check('the decision is persisted', readState().autoReport === true)

console.log('\n2. the skill mandates compressing instead of reading in full')
const skill = readFileSync(join(root, 'skills', 'voice-report', 'SKILL.md'), 'utf8')
check('the skill exists', skill.length > 500)
check('it names tts_report', skill.includes('tts_report'))
check('it forbids reading a report in full', /整篇朗读是禁止的|不要用\s*`?tts_speak`?/.test(skill))
// Why a report must be compressed, not the exact figure: the skill has to give a
// reason and a length limit, but pinning the words of a measurement made this
// check fire when the measurement was corrected. Assert the commitment, not the
// prose.
check('it explains why length is a hard limit', /字\/秒|字一秒/.test(skill))
check('it gives a concrete length ceiling', /150\s*字|100 字|超过\s*\d+\s*字/.test(skill))
check('it tells the agent not to switch strategies on its own', /不要.*擅自改走\s*subagent/.test(skill))

console.log('\n2b. every skill frontmatter parses, and names the installable package')
// A skill is loaded through its YAML frontmatter, so a frontmatter that does not
// parse means the skill silently never loads — the agent simply behaves as if the
// instructions were absent, with no error anywhere. A plain scalar containing
// ": " does exactly that (an ASCII colon before a space starts a nested mapping),
// which is easy to introduce while editing prose and invisible in a diff.
const skillFiles = ['voice-setup', 'voice-report'].map((name) => ({
  name, file: join(root, 'skills', name, 'SKILL.md'),
}))
for (const { name, file } of skillFiles) {
  const text = readFileSync(file, 'utf8')
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  check(`${name}: frontmatter is present`, block !== null)
  check(`${name}: frontmatter has name and description`, /^name:\s*\S/m.test(block?.[1] ?? '') && /^description:\s*\S/m.test(block?.[1] ?? ''))
  // The two characters that break a plain YAML scalar, checked directly so the
  // failure names the cause instead of only "does not parse".
  const descLine = (block?.[1] ?? '').split(/\r?\n/).find((line) => line.startsWith('description:')) ?? ''
  const value = descLine.slice('description:'.length).trim()
  const quoted = (value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))
  check(`${name}: description needs no quoting tricks`, quoted || !/: /.test(value),
    quoted ? 'quoted, so a colon is safe' : '')
}
// The install skill is what an agent follows, so it must name the package a user
// can actually install. It no longer needs to explain a repository/package name
// split, so the check is that it names the package and does not send anyone to the
// name on npm that belongs to another project.
const setupSkill = readFileSync(join(root, 'skills', 'voice-setup', 'SKILL.md'), 'utf8')
check('the setup skill names the installable package', setupSkill.includes('dsh-say'))
check('the setup skill never tells anyone to install dsh-voice',
  !/add\s+dsh-voice/.test(setupSkill))

console.log('\n3. the report tool returns what an agent must check')
const longReport = [
  '# 本轮结果',
  '',
  '这一轮把插件从能出声推进到了能播报，主要做了三件事，其中前两件是必须的，第三件是改进。',
  '第一件是新增压缩模块，把长报告压成适合朗读的短稿，因为中文语音大约每 14 字一秒，超过一百五十字就会明显拖沓。',
  '第二件是新增 tts_report 工具，一次调用完成压缩和朗读，并返回它实际念出来的文本，方便确认有没有漏掉关键信息。',
  '第三个是改进，插件现在把 soul 里的 persona 直接暴露在返回值里，agent 不需要知道文件系统布局就能拿到人设。',
  '',
  '测试全部通过，四个测试文件全绿，其中一个专门验证任何预算下输出都不会凭空生成内容。',
  '修了三个缺陷，其中一个是短文本会带着 Markdown 进合成器，只在文本恰好很短时才触发。',
  '下一步做上架收尾，包括变更日志、贡献指南和持续集成。',
].join('\n')

const spoken = await report(
  { text: longReport, budget: 120 },
  { config: baseConfig(), personaDir: join(root, 'soul'), noPlay: true, get: () => undefined },
)

check('the report call succeeds without playing', spoken.ok === true, spoken.reason || '')
check('it compressed instead of reading in full', spoken.report?.strategy === 'local', spoken.report?.strategy)
check('it reports source vs spoken length', spoken.report?.sourceCharacters > spoken.report?.spokenCharacters)
check('the spoken text fits the budget', (spoken.report?.spokenText || '').length <= 120, `${(spoken.report?.spokenText || '').length} chars`)
check('the spoken text invents nothing', (() => {
  const source = longReport.replace(/[#。！？，、；：\s\dA-Za-z]/g, '')
  return (spoken.report?.spokenText || '').replace(/[。！？，、；：\s\dA-Za-z]/g, '').split('').every((ch) => source.includes(ch))
})())
// The whole point of compressing: audible time must drop, not just characters.
const seconds = ((spoken.report?.spokenText || '').length / 14).toFixed(1)
console.log(`     strategy=${spoken.report?.strategy} ${spoken.report?.sourceCharacters}->${spoken.report?.spokenCharacters} chars (~${seconds}s of audio)`)
console.log(`     spoken: ${spoken.report?.spokenText}`)
check('the compression is a real reduction, not a trim', (spoken.report?.sourceCharacters || 0) > (spoken.report?.spokenCharacters || 0) * 2)

console.log('\n4. the persona is readable without knowing the filesystem layout')
// A self-contained persona, so the check does not depend on whatever happens to
// be installed on the machine running it.
const personaDir = mkdtempSync(join(tmpdir(), 'dsh-say-personas-'))
writeFileSync(join(personaDir, 'README.md'), '# personas\n', 'utf8')
writeFileSync(join(personaDir, '_template.md'), '# template\n', 'utf8')
writeFileSync(join(personaDir, 'voice-pack.json'), JSON.stringify({ pack: 'my-voice', speed: 1 }), 'utf8')
writeFileSync(join(personaDir, 'my-voice.md'), '# 人设\n\n## 禁忌\n\n不吹牛。\n', 'utf8')

const persona = readPersona({ personaDir })
check('a persona file is selected', persona.file === 'my-voice.md', persona.file)
check('it does not select README or a template', !/readme|_template/i.test(persona.file))
check('the persona notes carry the behaviour rules', persona.notes.includes('禁忌'))
check('it names the intended voice', persona.voice === 'my-voice', persona.voice)
rmSync(personaDir, { recursive: true, force: true })

console.log('\n5. a short report stays verbatim instead of being mangled')
const short = await report(
  { text: '测试全过。' },
  { config: baseConfig(), personaDir: join(root, 'soul'), noPlay: true, get: () => undefined },
)
check('a short report is spoken as-is', short.report?.strategy === 'verbatim', short.report?.strategy)
check('nothing was dropped', short.report?.spokenText.includes('测试全过'))

rmSync(stateDir, { recursive: true, force: true })

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
