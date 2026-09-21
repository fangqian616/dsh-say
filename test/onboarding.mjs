/**
 * Onboarding checks. Run: node test/onboarding.mjs
 *
 * Onboarding asks the user a small set of questions exactly once, and never at
 * load time (a question cannot be answered while the runtime is still booting).
 * These checks pin the marker, the answer mapping, and the failure paths.
 *
 * The question count is not fixed. The backend question - "you have no engine,
 * which one do you want?" - is added only when neither engine can run, because
 * there is nothing to decide otherwise. Pinning a count would have hidden that
 * rule instead of testing it, so the fake answerer checks the rule itself.
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

/**
 * A fake answerer that also enforces the shape of the question set.
 *
 * @param {object} choices  answers by question id
 * @param {{ expectBackend?: boolean }} [expect] assert whether the backend
 *   question is part of this batch
 */
const answerWith = (choices, expect = {}) => ({
  ask: async ({ questions }) => {
    const ids = questions.map((question) => question.id)
    const hasBackend = ids.includes('backend')
    if (expect.expectBackend !== undefined && hasBackend !== expect.expectBackend) {
      throw new Error(
        `expected the backend question to be ${expect.expectBackend ? 'present' : 'absent'}, question ids were: ${ids.join(',')}`,
      )
    }
    if (ids.indexOf('voice') !== 0) throw new Error(`voice must be asked first, got: ${ids.join(',')}`)
    const unknown = ids.filter((id) => !(id in choices) && id !== 'backend')
    if (unknown.length > 0) throw new Error(`no answer prepared for: ${unknown.join(',')}`)
    return {
      answers: ids.map((id) => ({
        id,
        selected: [id === 'backend' ? (choices.backend || '先用系统语音') : choices[id]],
        custom: '',
      })),
    }
  },
})

const answers = (voice, soul, report, backend) => ({ voice, soul, report, backend })

console.log('onboarding checks')
console.log(`  state dir: ${stateDir}`)

console.log('\n1. a fresh install has not onboarded')
check('isOnboarded is false', isOnboarded() === false)
check('the marker file does not exist yet', readState().onboarded === undefined)

console.log('\n2. onboarding needs both a question service and a calling agent')
const noService = await onboard({ agent: fakeAgent })
check('no userQuestions service is reported, not thrown', noService.status === 'unavailable', noService.note)
check('nothing is persisted when it could not ask', isOnboarded() === false)

const noAgent = await onboard({ userQuestions: answerWith(answers('a', 'b', 'c')) })
check('no calling agent is reported, not thrown', noAgent.status === 'unavailable', noAgent.note)
check('still nothing persisted', isOnboarded() === false)

console.log('\n3. a successful run persists the answers')
process.env.DSH_VOICE_STATE_DIR = stateDir
const first = await onboard({
  userQuestions: answerWith(answers('先用系统语音', '用默认人设', '要，压缩后播报')),
  agent: fakeAgent,
  installedVoice: 'my-voice',
})
check('status is asked', first.status === 'asked', first.status)
check('answers round-trip', first.answers?.voice === '先用系统语音', JSON.stringify(first.answers))
check('the marker is set', isOnboarded() === true)
check('the marker file exists', readFileSync(statePath(), 'utf8').includes('"onboarded": true'))

console.log('\n4. it does not ask twice')
const second = await onboard({ userQuestions: answerWith(answers('x', 'y', 'z')), agent: fakeAgent })
check('a second run short-circuits', second.status === 'already-done', second.status)

console.log('\n5. the report answer decides auto-reporting')
resetOnboarding()
const auto = await onboard({
  userQuestions: answerWith(answers('先用系统语音', '不要人设', '要，压缩后播报')),
  agent: fakeAgent,
})
check('the automatic answer enables auto-report', auto.autoReport === true)
check('"不要人设" disables the persona', auto.useSoul === false)
check('choosing system speech needs no follow-up', (auto.todos || []).length === 0, (auto.todos || []).join('; '))

console.log('\n5a. the backend question is asked only when there is a choice')
// Both engines missing is the one case where the answer is not already decided.
resetOnboarding()
const noEngine = await onboard({
  userQuestions: answerWith(answers('要用系统语音', '用默认人设', '不要自动播报'), { expectBackend: true }),
  agent: fakeAgent,
})
check('with no engine, the backend question is asked', (noEngine.answers || {}).backend !== undefined, JSON.stringify(noEngine.answers))

for (const [label, extra] of [
  ['a local GPT-SoVITS', { engineAvailable: true }],
  ['the ONNX engine', { onnxAvailable: true }],
  ['both engines', { engineAvailable: true, onnxAvailable: true }],
]) {
  resetOnboarding()
  const asked = await onboard({
    userQuestions: answerWith(answers('先用系统语音', '用默认人设', '不要自动播报'), { expectBackend: false }),
    agent: fakeAgent,
    ...extra,
  })
  check(`with ${label} present, the backend question is skipped`, asked.status === 'asked', asked.status)
}

console.log('\n5b. the backend answer becomes configuration')
resetOnboarding()
const choseOnnx = await onboard({
  userQuestions: answerWith(answers('我要导入别的声线', '用默认人设', '不要自动播报', '用自带的 ONNX 版（推荐）')),
  agent: fakeAgent,
})
check('picking ONNX pins the engine', choseOnnx.answers?.backend === '用自带的 ONNX 版（推荐）')
check('and the follow-up is the ONNX install',
  (choseOnnx.todos || []).some((t) => /install-onnx/.test(t)),
  (choseOnnx.todos || []).join(' | '))
check('the follow-up warns that GPU may silently fall back',
  (choseOnnx.todos || []).some((t) => /provider/.test(t)))
check('the follow-up states the engine has no speed control',
  (choseOnnx.todos || []).some((t) => /语速/.test(t)))

resetOnboarding()
const choseOwn = await onboard({
  userQuestions: answerWith(answers('我要导入别的声线', '用默认人设', '不要自动播报', '我已经有 GPT-SoVITS 了')),
  agent: fakeAgent,
})
check('picking an existing engine needs no install', !(choseOwn.todos || []).some((t) => /install-onnx/.test(t)))
check('and it does not push the 6.4 GB download',
  !(choseOwn.todos || []).some((t) => /6\.4 GB/.test(t)),
  (choseOwn.todos || []).join(' | '))

resetOnboarding()
const choseOfficial = await onboard({
  userQuestions: answerWith(answers('我要导入别的声线', '用默认人设', '不要自动播报', '我自己装官方的整合包')),
  agent: fakeAgent,
})
check('picking the official package gives the link',
  (choseOfficial.todos || []).some((t) => /huggingface\.co\/lj1995/.test(t)))
// 6.4 GB is the user's download to start, not the agent's.
check('and tells the agent to stop rather than download 6.4 GB',
  (choseOfficial.todos || []).some((t) => /不要替他下载/.test(t)),
  (choseOfficial.todos || []).join(' | '))

console.log('\n5c. wanting a voice without an engine says so, instead of a dead end')
// The failure this prevents: a user picks "import a voice", gets asked for weight
// paths, and only finds out after installing that nothing can speak them. The
// engine check turns that into an explicit instruction carrying both routes.
resetOnboarding()
const manual = await onboard({
  userQuestions: answerWith(answers('我要导入别的声线', '现在设定一个', '要，但我自己决定什么时候念', '先用系统语音')),
  agent: fakeAgent,
})
check('"I decide" leaves auto-report off', manual.autoReport === false)
check('setting a persona asks for follow-up', (manual.todos || []).some((t) => t.includes('人设')))
check('no engine, so the follow-up is about the engine',
  (manual.todos || []).some((t) => /没有任何可用的推理后端/.test(t)),
  (manual.todos || []).join(' | '))
check('the follow-up offers both routes',
  (manual.todos || []).some((t) => /install-onnx/.test(t)) && (manual.todos || []).some((t) => /huggingface\.co\/lj1995/.test(t)))
check('it does not ask for weight paths before an engine exists',
  !(manual.todos || []).some((t) => /问清楚模型权重位置/.test(t)))
check('it says the release is models, not a runtime',
  (manual.todos || []).some((t) => /不是运行时/.test(t)))

resetOnboarding()
const engineReady = await onboard({
  userQuestions: answerWith(answers('我要导入别的声线', '用默认人设', '不要自动播报')),
  agent: fakeAgent,
  engineAvailable: true,
})
check('with an engine, it asks for the weights instead',
  (engineReady.todos || []).some((t) => /问清楚模型权重位置/.test(t)),
  (engineReady.todos || []).join(' | '))
check('with an engine, it does not raise the engine question',
  !(engineReady.todos || []).some((t) => /推理后端/.test(t)))

for (const [label, extra] of [
  ['a local GPT-SoVITS', { engineAvailable: true }],
  ['the ONNX engine', { onnxAvailable: true }],
]) {
  resetOnboarding()
  const ready = await onboard({
    userQuestions: answerWith(answers('我要导入别的声线', '用默认人设', '不要自动播报'), { expectBackend: false }),
    agent: fakeAgent,
    ...extra,
  })
  check(`with ${label}, weight paths are the follow-up`,
    (ready.todos || []).some((t) => /问清楚模型权重位置/.test(t)),
    (ready.todos || []).join(' | '))
}

resetOnboarding()
const keepSystem = await onboard({
  userQuestions: answerWith(answers('先用系统语音', '用默认人设', '要，压缩后播报'), { expectBackend: false }),
  agent: fakeAgent,
  engineAvailable: false,
})
check('choosing the system voice never raises the engine question',
  (keepSystem.todos || []).length === 0,
  (keepSystem.todos || []).join(' | '))

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
