/**
 * Onboarding checks. Run: node test/onboarding.mjs
 *
 * Onboarding asks the user three questions exactly once, and never at load time
 * (a question cannot be answered while the runtime is still booting). These
 * checks pin the marker, the answer mapping, and the failure paths.
 *
 * The state directory is redirected to a temp path so a test run cannot consume
 * or rewrite the developer's own onboarding answers.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateDir = mkdtempSync(join(tmpdir(), 'dsh-say-onboarding-'))
process.env.DSH_VOICE_STATE_DIR = stateDir

const { isOnboarded, onboard, readState, resetOnboarding, statePath } = await import('../lib/onboarding.js')

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

const fakeAgent = { id: 'test-agent' }
const answerWith = (voice, soul, report) => ({
  ask: async ({ questions }) => {
    // The question set must always be the same three, in the same order.
    if (questions.length !== 3) throw new Error(`expected 3 questions, got ${questions.length}`)
    return {
      answers: [
        { id: 'voice', selected: [voice], custom: '' },
        { id: 'soul', selected: [soul], custom: '' },
        { id: 'report', selected: [report], custom: '' },
      ],
    }
  },
})

console.log('onboarding checks')
console.log(`  state dir: ${stateDir}`)

console.log('\n1. a fresh install has not onboarded')
check('isOnboarded is false', isOnboarded() === false)
check('the marker file does not exist yet', readState().onboarded === undefined)

console.log('\n2. onboarding needs both a question service and a calling agent')
const noService = await onboard({ agent: fakeAgent })
check('no userQuestions service is reported, not thrown', noService.status === 'unavailable', noService.note)
check('nothing is persisted when it could not ask', isOnboarded() === false)

const noAgent = await onboard({ userQuestions: answerWith('a', 'b', 'c') })
check('no calling agent is reported, not thrown', noAgent.status === 'unavailable', noAgent.note)
check('still nothing persisted', isOnboarded() === false)

console.log('\n3. a successful run persists the answers')
process.env.DSH_VOICE_STATE_DIR = stateDir
const first = await onboard({
  userQuestions: answerWith('要，压缩后播报', '用默认人设', '要，压缩后播报'),
  agent: fakeAgent,
  installedVoice: 'my-voice',
})
// The fake answers the three by id; report is the third.
check('status is asked', first.status === 'asked', first.status)
check('answers round-trip', first.answers?.voice === '要，压缩后播报', JSON.stringify(first.answers))
check('the marker is set', isOnboarded() === true)
check('the marker file exists', readFileSync(statePath(), 'utf8').includes('"onboarded": true'))

console.log('\n4. it does not ask twice')
const second = await onboard({ userQuestions: answerWith('x', 'y', 'z'), agent: fakeAgent })
check('a second run short-circuits', second.status === 'already-done', second.status)

console.log('\n5. the report answer decides auto-reporting')
resetOnboarding()
const auto = await onboard({
  userQuestions: answerWith('先用系统语音', '不要人设', '要，压缩后播报'),
  agent: fakeAgent,
})
check('the automatic answer enables auto-report', auto.autoReport === true)
check('"不要人设" disables the persona', auto.useSoul === false)
check('choosing system speech needs no follow-up', (auto.todos || []).length === 0, (auto.todos || []).join('; '))

resetOnboarding()
const manual = await onboard({
  userQuestions: answerWith('我要导入别的声线', '现在设定一个', '要，但我自己决定什么时候念'),
  agent: fakeAgent,
})
check('"I decide" leaves auto-report off', manual.autoReport === false)
check('importing a voice asks for follow-up', (manual.todos || []).some((t) => t.includes('导入别的声线')))
check('setting a persona asks for follow-up', (manual.todos || []).some((t) => t.includes('人设')))

console.log('\n6. a refused or cancelled question does not throw')
resetOnboarding()
const refused = await onboard({
  userQuestions: { ask: async () => { throw new Error('ASK_ABORTED') } },
  agent: fakeAgent,
})
check('a throwing answerer is contained', refused.status === 'unavailable', refused.note)
check('a refusal does not mark onboarding done', isOnboarded() === false)

rmSync(stateDir, { recursive: true, force: true })

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
