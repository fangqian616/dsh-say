/**
 * First-run onboarding.
 *
 * Three questions, asked once, at the first moment it is safe to ask them.
 *
 * Why not during plugin load: `apply()` runs as part of boot, and a question
 * answered through the UI cannot be delivered while boot is still in progress —
 * asking there deadlocks the runtime. So the questions are deferred to the first
 * tool call, which happens inside a live turn with a live caller.
 *
 * The marker is a small JSON file under the user's home directory. The plugin
 * writes it directly rather than depending on the settings service, so
 * onboarding still works in a composition that has no settings mounted.
 *
 * @module dsh-voice/lib/onboarding
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where dsh-voice keeps user-level state. */
export function stateDir() {
  return process.env.DSH_VOICE_STATE_DIR || join(homedir(), '.dsh', 'voice')
}

/** The onboarding marker file. */
export function statePath() {
  return join(stateDir(), 'state.json')
}

/** Read persisted state, or `{}` when it is absent or unreadable. */
export function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return {}
  }
}

/** Merge and persist state. */
export function writeState(patch) {
  const dir = stateDir()
  mkdirSync(dir, { recursive: true })
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() }
  writeFileSync(statePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/** True when onboarding has already run. */
export function isOnboarded() {
  return readState().onboarded === true
}

/** The three questions. `installedVoice` decides how the first one reads. */
function questions(installedVoice) {
  const first = installedVoice
    ? {
        id: 'voice',
        header: '声线',
        question: `已安装的声线包是「${installedVoice}」。要改用它吗，还是就用这个？`,
        options: [
          { label: '就用这个（推荐）', description: '不改动，之后想换再说。' },
          { label: '我要导入别的声线', description: '告诉你 GPT-SoVITS 的安装路径，我再引导你放权重和参考音。' },
          { label: '先用系统语音，不要角色声线', description: '改成系统自带语音，零依赖。' },
        ],
      }
    : {
        id: 'voice',
        header: '声线',
        question: '目前还没有安装任何角色声线，只登记了系统语音。要现在导入别的声线吗？',
        options: [
          { label: '先用系统语音（推荐）', description: '不下载任何东西，立刻能用。' },
          { label: '我要导入别的声线', description: '需要你自己提供 3-10 秒参考音和模型权重，或使用项目自带的声线包。' },
          { label: '以后再说', description: '跳过这一步。' },
        ],
      }

  return [
    first,
    {
      id: 'soul',
      header: '人设',
      question: '要不要给播报设一个人设（soul）？它会决定语音汇报的语气和措辞。',
      options: [
        { label: '用默认人设（推荐）', description: '沿用 soul/ 里现有的那份，你可以随时改。' },
        { label: '现在设定一个', description: '你告诉我这个角色的性格，我写一份人设文件。' },
        { label: '不要人设', description: '用平实语气播报，不加角色色彩。' },
      ],
    },
    {
      id: 'report',
      header: '自动汇报',
      question: '每次汇报结束时，要不要自动用语音念一遍大致结果？',
      options: [
        { label: '要，压缩后播报（推荐）', description: '把长报告压到十几秒再念，避免整篇朗读拖时间。' },
        { label: '要，但我自己决定什么时候念', description: '默认不自动播报，你说了才念。' },
        { label: '不要自动播报', description: '只在明确要求时才出声。' },
      ],
    },
  ]
}

/**
 * Ask the onboarding questions once.
 *
 * @param {object} options
 * @param {object} options.userQuestions the `userQuestions` service
 * @param {object} [options.agent] the exact live calling Agent (required: a
 *   question asked from a delegated child has no human answerer and blocks)
 * @param {string} [options.installedVoice] the voice pack currently registered
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ status: 'asked'|'already-done'|'unavailable', answers?: object, note?: string }>}
 */
export async function onboard(options) {
  const { userQuestions, agent, installedVoice, signal } = options

  if (isOnboarded()) return { status: 'already-done' }
  if (!userQuestions || typeof userQuestions.ask !== 'function') {
    return { status: 'unavailable', note: 'the userQuestions service is not mounted; onboarding skipped' }
  }
  if (!agent) {
    return { status: 'unavailable', note: 'no calling agent, so no human answerer is guaranteed; onboarding skipped' }
  }

  let answer
  try {
    answer = await userQuestions.ask({ questions: questions(installedVoice), agent, signal })
  } catch (error) {
    // A cancelled or refused question must not break the tool that triggered it.
    return { status: 'unavailable', note: `onboarding could not be asked: ${String(error?.message || error)}` }
  }

  const byId = {}
  for (const item of answer?.answers || []) {
    if (item && typeof item.id === 'string') {
      byId[item.id] = (item.custom && item.custom.trim()) || (item.selected && item.selected[0]) || ''
    }
  }

  const voiceChoice = byId.voice || ''
  const soulChoice = byId.soul || ''
  const reportChoice = byId.report || ''

  writeState({
    onboarded: true,
    voiceChoice,
    soulChoice,
    reportChoice,
    // Only the automatic options enable auto-reporting; "I decide" and "no"
    // both mean a report is spoken on request, never on its own.
    autoReport: /^要，压缩后播报/.test(reportChoice),
    useSoul: !/不要人设/.test(soulChoice),
  })

  const todos = []
  if (/导入别的声线/.test(voiceChoice)) {
    todos.push('用户要导入别的声线：问清楚 GPT-SoVITS 的安装路径、模型权重位置、以及 3-10 秒参考音，然后用 tts_voices action=add 登记')
  }
  if (/现在设定一个/.test(soulChoice)) {
    todos.push('用户要现在设人设：问清楚角色的性格与语气，写进 soul/ 目录（可先复制 _template.md）')
  }

  return {
    status: 'asked',
    answers: { voice: voiceChoice, soul: soulChoice, report: reportChoice },
    autoReport: /^要，压缩后播报/.test(reportChoice),
    useSoul: !/不要人设/.test(soulChoice),
    // Only genuinely unfinished business belongs here. "Keep the system voice"
    // and "use the default persona" are decisions, not pending follow-ups, and
    // listing them would send the agent off to ask a question already answered.
    todos,
    note: todos.length > 0
      ? `Onboarding recorded. Follow up on these now: ${todos.join('; ')}`
      : 'Onboarding recorded; every choice was a decision, so there is nothing to follow up.',
  }
}

/** Reset the marker, so onboarding can be seen again. */
export function resetOnboarding() {
  return writeState({ onboarded: false })
}

/** Whether the marker file exists at all; used by diagnostics. */
export function stateExists() {
  return existsSync(statePath())
}
