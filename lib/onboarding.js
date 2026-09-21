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

/**
 * The backend question, asked only when no engine can speak a character voice.
 *
 * It is not asked when an engine is already installed: in that case there is
 * nothing for the user to decide, and a question with an obvious answer is just
 * an interruption. It is asked in the same batch as the rest rather than after
 * them, because `userQuestions.ask` takes one set of questions and a second
 * round would double the interruptions to answer the same thing.
 */
function backendQuestion() {
  return {
    id: 'backend',
    header: '推理后端',
    question: '角色声线需要一个推理后端，本机现在一个都没有。你想用哪种？',
    options: [
      {
        label: '用自带的 ONNX 版（推荐）',
        description: '约 1 GB，比官方整合包省将近 5.5 GB；需要 Python（脚本会自己建环境）。速度比整合包慢一些，但远快于实时。',
      },
      {
        label: '我已经有 GPT-SoVITS 了',
        description: '零下载，而且它比 ONNX 版更快 —— 如果不在常见位置，告诉我它在哪个盘。',
      },
      {
        label: '我自己装官方的整合包',
        description: '约 6.4 GB，解压双击就能用，不用装 Python。我给你链接，你自己下。',
      },
      {
        label: '先用系统语音',
        description: '零下载，立刻能用；以后想要角色声线再配。',
      },
    ],
  }
}

/** The three questions. `installedVoice` decides how the first one reads. */
function questions(installedVoice, options = {}) {
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
    ...(options.offerBackend ? [backendQuestion()] : []),
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
 * @param {string[]} [options.installedVoiceEngines] engines that pack can run on
 * @param {boolean} [options.engineAvailable] whether a local GPT-SoVITS can run here
 * @param {string} [options.engineBusyReason] why it cannot, when it cannot
 * @param {boolean} [options.onnxAvailable] whether the ONNX engine can run here
 * @param {string} [options.onnxReason] why it cannot, when it cannot
 * @param {'cuda'|'cpu'} [options.onnxDevice] the provider the ONNX build offers
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ status: 'asked'|'already-done'|'unavailable', answers?: object, note?: string }>}
 */
export async function onboard(options) {
  const { userQuestions, agent, installedVoice, signal } = options
  // Absent means "not determined" rather than "unavailable": a caller that cannot
  // check the engine should not produce an installation prompt for it.
  const engineAvailable = options.engineAvailable === true
  const engineBusyReason = options.engineBusyReason || ''
  const onnxAvailable = options.onnxAvailable === true
  const onnxReason = options.onnxReason || ''
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

  // Asked only when there is genuinely a choice to make. With either engine
  // present the answer is already decided, and a question whose answer is
  // obvious is an interruption rather than onboarding.
  const offerBackend = !engineAvailable && !onnxAvailable

  let answer
  try {
    answer = await userQuestions.ask({ questions: questions(installedVoice, { offerBackend }), agent, signal })
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
  const backendChoice = byId.backend || ''

  writeState({
    onboarded: true,
    voiceChoice,
    soulChoice,
    reportChoice,
    backendChoice,
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
  // The backend answer is only written when it says something the plugin does
  // not already know. "I will install the official package myself" is a plan,
  // not a configuration, and pinning the engine to a route that does not exist
  // yet would break the first call.
  //
  // "I already have GPT-SoVITS" counts as one of those: the user says it exists,
  // our search did not find it, so the honest state is still `auto`. Pinning
  // `gpt-sovits` here would turn every later call into a hard failure instead of
  // a fallback to the system voice, over a path that has not been given yet.
  const assertsOwnEngine = /已经有 GPT-SoVITS/.test(backendChoice)
  if (/ONNX/.test(backendChoice)) {
    applySetting(settingsPatch, 'engine', 'onnx')
  } else if (assertsOwnEngine && engineAvailable) {
    applySetting(settingsPatch, 'engine', 'gpt-sovits')
  } else if (/先用系统语音/.test(backendChoice)) {
    applySetting(settingsPatch, 'engine', 'builtin')
  }
  applySetting(settingsPatch, 'useSoul', !/不要人设/.test(soulChoice))
  applySetting(settingsPatch, 'autoReport', /^要，压缩后播报/.test(reportChoice))
  writeSettings(settingsPatch)

  const todos = []
  const wantsVoice = /导入别的声线/.test(voiceChoice)

  // The backend answer comes first: it decides which installation the other
  // follow-ups can even refer to.
  if (assertsOwnEngine && !engineAvailable) {
    todos.push(
      [
        '用户说他本机已经有 GPT-SoVITS，但自动查找没找到（常见位置和每个盘根目录都扫过了）',
        '**不要再劝他装任何东西** —— 他要的是用起来，不是再下一份',
        '问他 GPT-SoVITS 装在哪个目录（解压出来的那个文件夹，里面应该有 api_v2.py）',
        '拿到路径后用 tts_config 写 engines.gptSovits.engineRoot，再跑 tts_engines 确认 available 变成 true',
        '如果他说的是"已经装好但没在用"，也确认一下要不要顺便装声线（tts_voices action=add）',
      ].join('\n  '),
    )
  } else if (/ONNX/.test(backendChoice)) {
    todos.push(
      [
        '用户选择了 ONNX 版（不需要 GPT-SoVITS，约 1 GB）',
        '这一步要主动做完，并如实转述结果：',
        '① 跑 `node scripts/install-onnx.mjs`：建受管 venv（Python 3.9-3.13）、装 genie-tts、下 Genie 资源',
        '② 脚本会自己处理 jieba_fast（它只有源码包、需要 MSVC）—— 失败时不要叫用户去装 Visual Studio',
        '③ 装完用 tts_engines 确认 onnx.available 为 true，并**转述它实际用的 provider**',
        '④ 如果报告在跑 CPU 而用户有 NVIDIA 显卡：说明 --gpu 可以试，但**实测本机加了 CUDA 库仍会静默回退**，原因未查明；不要说"装上就是 GPU 了"',
        '⑤ ONNX 引擎不支持调节语速，用户问起时直接说明，不要说"已生效"',
        '⑥ 不要说 ONNX 版更快 —— 实测报告长度的一句话，ONNX 8.9s 而 GPT-SoVITS 4.7s。它的价值是省将近 5.5 GB',
      ].join('\n  '),
    )
  } else if (/我自己装官方的/.test(backendChoice)) {
    const official = 'https://huggingface.co/lj1995/GPT-SoVITS-windows-package/resolve/main/GPT-SoVITS-v3lora-20250228.7z'
    todos.push(
      [
        '用户选择自己安装官方 GPT-SoVITS 整合包（约 6.4 GB）',
        `给他这个链接就停下：${official}（解压双击 _go-webui.bat，不用装 Python）`,
        '**不要替他下载这 6.4 GB** —— 这是他的决定，不是你的任务；他装好后会说，届时再继续装声线',
      ].join('\n  '),
    )
  }

  // A character voice needs a working engine. Saying so at this point - rather
  // than letting the user discover it when nothing comes out of the speakers - is
  // the difference between a feature and a dead end, so the engine check produces
  // an explicit instruction with the download link and the measured size.
  if (engineAvailable !== true && onnxAvailable !== true && (wantsVoice || hasVoicePack) && !/ONNX/.test(backendChoice) && !assertsOwnEngine) {
    const official = 'https://huggingface.co/lj1995/GPT-SoVITS-windows-package/resolve/main/GPT-SoVITS-v3lora-20250228.7z'
    todos.push(
      [
        '用户想要角色声线，但本机没有任何可用的推理后端' +
        (engineBusyReason ? `（GPT-SoVITS: ${engineBusyReason}；ONNX: ${onnxReason}）` : ''),
        '明确告诉用户这一步，不要说"已经装好了"',
        '然后二选一，把体积和前置条件都讲清楚：',
        `① ONNX 版：\`node scripts/install-onnx.mjs\`，约 1 GB，需要 Python，比整合包慢一些但远快于实时`,
        `② 官方整合包：${official}（6.4 GB，解压双击 _go-webui.bat，不用装 Python；装完反而更快）`,
        '③ 说明本项目的发布包给的是模型和声线，不是运行时；两者不冲突，且发布包比整合包小得多',
        '装完用 tts_voices action=list 确认登记的是声线权重而不是 base 模型（gpt= 不该是 s1v3.ckpt，sovits= 不该是 s2Gv2ProPlus.pth）—— 选错时安装会报成功，只有听的时候才发现声音不对',
      ].join('\n  '),
    )
  } else if (wantsVoice && installedVoice) {
    todos.push('用户要改用已有的声线包：确认引擎可用后把它设为默认，然后念一句验证')
  }
  if (wantsVoice && !installedVoice && (engineAvailable === true || onnxAvailable === true)) {
    todos.push('用户要导入别的声线：问清楚模型权重位置和 3-10 秒参考音，然后用 tts_voices action=add 登记')
  }
  if (/现在设定一个/.test(soulChoice)) {
    todos.push('用户要现在设人设：问清楚角色的性格与语气，写进 soul/ 目录（可先复制 _template.md）')
  }

  return {
    status: 'asked',
    answers: { voice: voiceChoice, backend: backendChoice, soul: soulChoice, report: reportChoice },
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
