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
 * @module dsh-say/lib/onboarding
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { applySetting, writeSettings } from './settings.js'

/** Where dsh-say keeps user-level state. */
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
 * @param {boolean} [options.engineAvailable] whether GPT-SoVITS can run here
 * @param {string} [options.engineBusyReason] why it cannot, when it cannot
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ status: 'asked'|'already-done'|'unavailable', answers?: object, note?: string }>}
 */
export async function onboard(options) {
  const { userQuestions, agent, installedVoice, signal } = options
  // Absent means "not determined" rather than "unavailable": a caller that cannot
  // check the engine should not produce an installation prompt for it.
  const engineAvailable = options.engineAvailable === true
  const engineBusyReason = options.engineBusyReason || ''
  // A registered pack is proof the user is after a character voice even if this
  // run's answer is to keep the system one for now.
  const hasVoicePack = Boolean(installedVoice)

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

  // The answers also become plugin settings, so a choice made by talking to the
  // agent is written down where the plugin reads it. Asking a user to edit a
  // cordis YAML for this would be the wrong ergonomics: that file holds every
  // other plugin's rows and breaking it breaks the whole profile.
  const settingsPatch = {}
  if (/系统语音/.test(voiceChoice)) {
    // Pinning the engine keeps the promise the user just chose: no pack needed.
    applySetting(settingsPatch, 'engine', 'builtin')
  } else if (/导入别的声线/.test(voiceChoice) && installedVoice) {
    applySetting(settingsPatch, 'engine', 'gpt-sovits')
    applySetting(settingsPatch, 'defaultVoice', installedVoice)
  }
  applySetting(settingsPatch, 'useSoul', !/不要人设/.test(soulChoice))
  applySetting(settingsPatch, 'autoReport', /^要，压缩后播报/.test(reportChoice))
  writeSettings(settingsPatch)

  const todos = []
  const wantsVoice = /导入别的声线/.test(voiceChoice)

  // A character voice needs GPT-SoVITS running. Saying so at this point - rather
  // than letting the user discover it when nothing comes out of the speakers - is
  // the difference between a feature and a dead end, so the engine check produces
  // an explicit instruction with the download link and the measured size.
  if (engineAvailable !== true && (wantsVoice || hasVoicePack)) {
    const official = 'https://huggingface.co/lj1995/GPT-SoVITS-windows-package/resolve/main/GPT-SoVITS-v3lora-20250228.7z'
    todos.push(
      [
        '用户想要角色声线，但本机没有可用的 GPT-SoVITS 引擎' + (engineBusyReason ? `（${engineBusyReason}）` : ''),
        '明确告诉用户这一步，不要说"已经装好了"',
        '然后：',
        `① 说明需要先有一个能跑的 GPT-SoVITS。官方 Windows 整合包 ${official}（6.4 GB，解压双击 _go-webui.bat 即可，不用装 Python）`,
        '② 说明本项目的发布包给的是模型和声线，不是运行时；两者不冲突，且发布包比整合包小得多',
        '③ 用户同意后，用 voice-setup 技能把声线装上：发布包下载到 Downloads 后跑 `node scripts/install-voice.mjs`（自动找到它），它会解压、把 base 模型铺进引擎、登记声线包',
        '④ 装完用 tts_voices action=list 确认登记的是声线权重而不是 base 模型（gpt= 不该是 s1v3.ckpt，sovits= 不该是 s2Gv2ProPlus.pth）—— 选错时安装会报成功，只有听的时候才发现声音不对',
      ].join('\n  '),
    )
  } else if (wantsVoice && installedVoice) {
    todos.push('用户要改用已有的声线包：确认引擎可用后把它设为默认，然后念一句验证')
  }
  if (wantsVoice && !installedVoice && engineAvailable === true) {
    todos.push('用户要导入别的声线：问清楚模型权重位置和 3-10 秒参考音，然后用 tts_voices action=add 登记')
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
