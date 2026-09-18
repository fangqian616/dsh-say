/**
 * Model-facing tools.
 *
 * One tool does the work (`tts_speak`); two are for setup and inspection
 * (`tts_engines`, `tts_voices`). They are plain functions over a context object
 * so they can be unit-tested without a live harness.
 *
 * @module dsh-voice/lib/tools
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import builtin from './engines/builtin.js'
import gptsovits from './engines/gptsovits.js'
import { cleanup, playFile, audioDuration } from './util.js'
import { compressReport } from './summarize.js'
import { SETTING_KEYS, applySetting, readSettings, settingsPath, writeSettings } from './settings.js'
import { ensureVoicesDir, findVoicePack, listVoicePacks, pickVoicePack } from './voice-store.js'

/**
 * Read the report persona that `soul/` describes: which voice pack to speak
 * with, and the behaviour notes a report-writing agent should follow.
 *
 * The plugin exposes this so the agent does not have to locate the package on
 * disk. Persona files are plain Markdown and change nothing about the engine.
 */
export function readPersona(ctx) {
  const dir = ctx.personaDir
  if (!dir) return { dir: '', voice: '', speed: undefined, files: [], notes: '' }

  let files = []
  try {
    // `_template.md` is a starting point, `README.md` explains the directory:
    // neither is a persona, so neither may become the active one.
    files = readdirSync(dir)
      .filter((entry) => entry.endsWith('.md') && !entry.startsWith('_') && entry.toLowerCase() !== 'readme.md')
      .sort()
  } catch {
    return { dir, voice: '', speed: undefined, files: [], notes: '' }
  }

  let selection = {}
  try {
    const raw = readFileSync(join(dir, 'voice-pack.json'), 'utf8').replace(/^\uFEFF/, '')
    selection = JSON.parse(raw)
  } catch {
    selection = {}
  }

  // The first non-template persona file is the active one until a user says
  // otherwise; selections below can still override the voice independently.
  const active = files[0] || ''
  let notes = ''
  if (active) {
    try {
      notes = readFileSync(join(dir, active), 'utf8').replace(/^\uFEFF/, '').trim()
    } catch {
      notes = ''
    }
  }

  return {
    dir,
    file: active,
    files,
    voice: selection.pack || '',
    speed: typeof selection.speed === 'number' ? selection.speed : undefined,
    notes,
  }
}

/** Thrown for a caller mistake (bad argument); returned as a normal tool error. */
function failure(reason) {
  return { ok: false, reason }
}

/**
 * Decide which engine handles this call.
 *
 * `auto` prefers GPT-SoVITS as soon as a usable voice pack exists, so a user who
 * installs an engine gets it without editing configuration.
 */
export async function selectEngine(ctx, requested) {
  const config = ctx.config
  const wanted = requested || config.engine || 'auto'

  if (wanted === 'builtin') {
    const status = await builtin.probe()
    if (!status.available) return { ok: false, reason: `the built-in engine is unavailable: ${status.reason}` }
    return { ok: true, engine: builtin, id: 'builtin' }
  }

  if (wanted === 'gpt-sovits') {
    const status = await gptsovits.discover(config)
    if (!status.available) return { ok: false, reason: status.reason }
    return { ok: true, engine: gptsovits, id: 'gpt-sovits', status }
  }

  const packs = listVoicePacks({ voicesDir: config.voicesDir })
  const healthy = packs.filter((pack) => !pack.problem)
  if (healthy.length > 0) {
    const status = await gptsovits.discover(config)
    if (status.available) return { ok: true, engine: gptsovits, id: 'gpt-sovits', status }
  }

  const builtinStatus = await builtin.probe()
  if (builtinStatus.available) return { ok: true, engine: builtin, id: 'builtin' }

  return {
    ok: false,
    reason:
      `no engine is usable. ${builtinStatus.reason}. ` +
      `For character voices install GPT-SoVITS and register a voice pack in ${config.voicesDir}.`,
  }
}

/** Resolve the voice pack or OS voice for this call. */
function resolveVoice(engineId, ctx, args, persona) {
  if (engineId === 'builtin') {
    const voice = args.voice || ctx.config.defaultVoiceBuiltin || ''
    return { voice }
  }
  const packs = listVoicePacks({ voicesDir: ctx.config.voicesDir })
  if (packs.length === 0) {
    return {
      error:
        `no voice pack is registered in ${ctx.config.voicesDir}. ` +
        'Add one with: tts_voices action=add name=<voice> refAudio=<path> gpt=<rel .ckpt> sovits=<rel .pth>',
    }
  }
  const wanted = args.voice || persona?.voice || ctx.config.defaultVoice
  const pack = wanted
    ? packs.find((candidate) => candidate.name === wanted)
    : pickVoicePack(packs, ctx.config.defaultVoice)
  if (!pack) {
    return {
      error: `unknown voice "${wanted}". Registered: ${packs.map((p) => p.name).join(', ') || '(none)'}`,
    }
  }
  if (pack.problem) return { error: `voice pack "${pack.name}" is incomplete: ${pack.problem}` }
  return { pack }
}

/** `tts_speak` — synthesize and play. */
export async function speak(args, ctx) {
  const onboarding = await maybeOnboard(ctx, args)
  const text = typeof args.text === 'string' ? args.text : ''
  if (!text.trim()) return failure('text is empty — pass the words to speak in `text`')

  const persona = readPersona(ctx)
  const selected = await selectEngine(ctx, args.engine)
  if (!selected.ok) return failure(selected.reason)

  const voice = resolveVoice(selected.id, ctx, args, persona)
  if (voice.error) return failure(voice.error)

  const speed = typeof args.speed === 'number' && Number.isFinite(args.speed)
    ? args.speed
    : (persona.speed ?? ctx.config.speed)
  // The language belongs to the call, not only to the configuration: one session
  // mixes Chinese reports, English identifiers, and quoted foreign text. It also
  // has to be the language the TEXT is in, not the voice pack's own language.
  const textLang = typeof args.textLang === 'string' && args.textLang ? args.textLang : ctx.config.textLang
  const promptLang = typeof args.promptLang === 'string' && args.promptLang ? args.promptLang : ctx.config.promptLang
  const saveTo = typeof args.saveTo === 'string' && args.saveTo.trim() ? args.saveTo.trim() : ''

  let result
  try {
    result = await selected.engine.synthesize({
      text,
      voice: voice.voice,
      pack: voice.pack,
      config: { ...ctx.config, textLang, promptLang },
      speed,
      outputPath: saveTo || undefined,
      signal: ctx.signal,
    })
  } catch (error) {
    return failure(`synthesis crashed: ${String(error?.message || error)}`)
  }

  if (!result.ok) return failure(result.reason || 'synthesis failed')

  const keep = Boolean(saveTo) || ctx.config.keepAudio
  let played = { played: true }
  if (!ctx.noPlay) {
    try {
      // An engine may own playback (the built-in one does, through the OS). An
      // engine that only produces audio falls back to the shared player, so a
      // backend is never required to implement playback just to be usable.
      const playWith = typeof selected.engine.play === 'function'
        ? (file, options) => selected.engine.play(file, options)
        : (file, options) => playFile(file, options)
      played = await playWith(result.audio, {
        signal: ctx.signal,
        ffplayPath: ctx.config.engines?.gptSovits?.ffplayPath,
      })
    } catch (error) {
      played = { played: false, error: String(error?.message || error) }
    }
  }

  // Duration is read from the wav header locally, so an engine never needs an
  // external media tool just to report how long its output is.
  const measure = ctx.measureDuration || ((file) => audioDuration(file))
  const durationSeconds = await measure(result.audio)
  if (!keep) cleanup(result.audio)

  return {
    ok: true,
    engine: selected.id,
    voice: result.voice || voice.pack?.name || voice.voice || '(system default)',
    durationSeconds,
    elapsedSeconds: result.elapsedSeconds || 0,
    played: played.played === true,
    playError: played.error || '',
    audio: keep ? result.audio : '',
    textPreview: text.length > 60 ? `${text.slice(0, 60)}…` : text,
    ...(onboarding ? { onboarding } : {}),
  }
}

/**
 * Run first-use onboarding when it applies, returning the follow-up the caller
 * should act on. Never throws: an onboarding failure must not break the tool
 * that happened to trigger it.
 */
async function maybeOnboard(ctx, args) {
  const force = args.forceOnboarding === true
  if (!force && !ctx.needsOnboarding) return undefined
  if (typeof ctx.onboard !== 'function') return undefined
  try {
    return await ctx.onboard({ force })
  } catch (error) {
    return { status: 'unavailable', note: `onboarding failed: ${String(error?.message || error)}` }
  }
}

/**
 * `tts_report` — speak a report without reading it all out.
 *
 * Hearing a written report read in full is slower than reading it, so the text
 * is compressed to a character budget first. The local strategy is the default
 * on purpose: it costs no extra model call and no extra wall-clock time, which
 * matters most exactly when a report is long and the speech budget is tight.
 */
export async function report(args, ctx) {
  const onboarding = await maybeOnboard(ctx, args)
  const text = typeof args.text === 'string' ? args.text : ''
  if (!text.trim()) return failure('text is empty — pass the report to summarize in `text`')

  const persona = readPersona(ctx)
  const budget = typeof args.budget === 'number' && Number.isFinite(args.budget)
    ? args.budget
    : ctx.config.reportBudget
  const wantSubagent = args.compress === 'subagent'

  const subagents = wantSubagent ? ctx.get?.('subagents') : undefined
  const compressed = await compressReport({
    text,
    budget,
    persona: persona.notes,
    subagents,
    parent: ctx.agent,
    signal: ctx.signal,
  })

  const spoken = await speak(
    {
      text: compressed.text,
      voice: args.voice,
      engine: args.engine,
      speed: args.speed,
      textLang: typeof args.textLang === 'string' && args.textLang ? args.textLang : ctx.config.textLang,
      saveTo: args.saveTo,
    },
    ctx,
  )

  if (spoken.ok !== true) return spoken
  return {
    ...spoken,
    report: {
      sourceCharacters: text.length,
      spokenCharacters: compressed.characters,
      strategy: compressed.via,
      truncated: compressed.truncated,
      spokenText: compressed.text,
    },
    ...(onboarding ? { onboarding } : {}),
  }
}

/**
 * `tts_config` — read or change the plugin's own settings.
 *
 * Settings live in a file under the user's home directory rather than in the
 * cordis composition, because changing a voice should not mean editing a profile
 * YAML that also holds every other plugin's rows.
 */
export async function configTool(args, ctx) {
  const action = typeof args.action === 'string' ? args.action : 'read'
  const path = ctx.settingsPath || settingsPath()

  if (action === 'read') {
    const stored = readSettings()
    // The effective view is the composition's config with the user's file merged
    // over it — the same precedence the plugin applies at startup. Reporting only
    // `ctx.config` would show what the composition says, not what will happen.
    const merged = { ...ctx.config }
    for (const [key, value] of Object.entries(stored)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value) && typeof merged[key] === 'object') {
        merged[key] = { ...merged[key], ...value }
      } else if (value !== undefined) {
        merged[key] = value
      }
    }
    return {
      ok: true,
      action: 'read',
      path,
      stored,
      effective: {
        engine: merged.engine,
        defaultVoice: merged.defaultVoice,
        defaultVoiceBuiltin: merged.defaultVoiceBuiltin,
        speed: merged.speed,
        textLang: merged.textLang,
        reportBudget: merged.reportBudget,
        keepAudio: merged.keepAudio,
        voicesDir: merged.voicesDir,
        personaDir: merged.personaDir || ctx.personaDir || '',
        engines: merged.engines,
      },
      keys: SETTING_KEYS,
    }
  }

  if (action === 'set') {
    const key = typeof args.key === 'string' ? args.key.trim() : ''
    if (!key) return failure('set needs a key; see tts_config action=read for the list')
    if (!(key in SETTING_KEYS)) {
      return failure(`unknown setting "${key}". Valid keys: ${Object.keys(SETTING_KEYS).join(', ')}`)
    }
    if (args.value === undefined) return failure('set needs a value')

    // A string is parsed as JSON when it looks like it, so callers may pass
    // `true`, `1.2`, or `"zh"` and get the type the schema expects.
    let value = args.value
    if (typeof value === 'string') {
      const text = value.trim()
      if (text === 'true') value = true
      else if (text === 'false') value = false
      else if (text !== '' && !Number.isNaN(Number(text)) && /^-?\d+(\.\d+)?$/.test(text)) value = Number(text)
      else value = text
    }

    // Voice-selection keys take effect on the next call; the rest are read once
    // at startup, so the answer says which is which instead of pretending.
    const takesEffectNow = ['defaultVoice', 'defaultVoiceBuiltin', 'speed', 'textLang', 'reportBudget', 'keepAudio']
    writeSettings(applySetting({}, key, value))
    return {
      ok: true,
      action: 'set',
      path,
      key,
      value,
      effective: takesEffectNow.includes(key) || key.startsWith('engines.')
        ? 'next call'
        : 'next restart',
      stored: readSettings(),
    }
  }

  return failure(`unknown action "${action}" — expected read or set`)
}

/** `tts_engines` — what can speak right now, plus the active report persona. */export async function engines(_args, ctx) {
  const builtinStatus = await builtin.probe()
  const gptStatus = await gptsovits.discover(ctx.config)
  const packs = listVoicePacks({ voicesDir: ctx.config.voicesDir })
  const persona = readPersona(ctx)

  return {
    ok: true,
    selected: (await selectEngine(ctx)).id || '',
    configured: ctx.config.engine,
    builtin: {
      available: builtinStatus.available === true,
      reason: builtinStatus.reason || '',
      voices: (builtinStatus.voices || []).length,
    },
    gptSovits: {
      available: gptStatus.available === true,
      mode: gptStatus.mode || 'none',
      engineRoot: gptStatus.engineRoot || '',
      serverUrl: gptStatus.serverUrl || '',
      python: gptStatus.python || '',
      reason: gptStatus.reason || '',
      weights: gptStatus.weights ? {
        gpt: (gptStatus.weights.gpt || []).map((entry) => entry.rel),
        sovits: (gptStatus.weights.sovits || []).map((entry) => entry.rel),
      } : { gpt: [], sovits: [] },
    },
    voicePacks: packs.map((pack) => ({ name: pack.name, version: pack.version, problem: pack.problem })),
    voicesDir: ctx.config.voicesDir,
    // The report persona travels with the answer: an agent that speaks a report
    // needs the behaviour notes and the intended voice in the same call.
    persona,
  }
}

/** `tts_voices` — list, add, or remove voice packs, and list OS voices. */
export async function voices(args, ctx) {
  const action = typeof args.action === 'string' ? args.action : 'list'
  const voicesDir = ensureVoicesDir(ctx.config.voicesDir)

  if (action === 'list') {
    const packs = listVoicePacks({ voicesDir })
    const builtinStatus = await builtin.probe()
    return {
      ok: true,
      action: 'list',
      voicesDir,
      packs,
      builtinVoices: builtinStatus.available ? builtinStatus.voices || [] : [],
      builtinReason: builtinStatus.reason || '',
    }
  }

  if (action === 'add') {
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    if (!/^[\w\u4e00-\u9fa5-]{1,48}$/.test(name)) {
      return failure('name must be 1-48 characters of letters, digits, underscore, hyphen, or CJK text')
    }
    const refAudio = typeof args.refAudio === 'string' ? args.refAudio.trim() : ''
    const gpt = typeof args.gpt === 'string' ? args.gpt.trim() : ''
    const sovits = typeof args.sovits === 'string' ? args.sovits.trim() : ''
    if (!refAudio || !gpt || !sovits) {
      return failure('add needs refAudio, gpt, and sovits (see docs/VOICES.md)')
    }

    const dir = join(voicesDir, name)
    mkdirSync(dir, { recursive: true })
    try {
      copyFileSync(refAudio, join(dir, 'ref.wav'))
    } catch (error) {
      return failure(`could not copy the reference audio: ${String(error?.message || error)}`)
    }
    writeFileSync(join(dir, 'ref.txt'), typeof args.promptText === 'string' ? args.promptText : '', 'utf8')

    const version = args.version || gptsovits.versionFromDirName(sovits.split('/')[0] || sovits.split('\\')[0]) || ctx.config.engines.gptSovits.version
    writeFileSync(
      join(dir, 'pack.json'),
      // `notice` records where the material came from and what terms the user is
      // working under. It is a note, not a license this plugin can grant: the
      // rights in a cloned voice belong to whoever owns the character and the
      // recording. `license` is still read for packs written by older versions.
      `${JSON.stringify({ name, version, gpt, sovits, notice: args.notice || args.license || '' }, null, 2)}\n`,
      'utf8',
    )

    const written = findVoicePack({ voicesDir }, name)
    return {
      ok: true,
      action: 'add',
      name,
      dir,
      version,
      problem: written?.problem || '',
      note: written?.problem
        ? `pack registered but incomplete: ${written.problem}`
        : 'voice pack registered',
    }
  }

  return failure(`unknown action "${action}" — expected list or add`)
}

/** Tool definitions, in the shape the tool registry expects. */
export function defineTools() {
  return [
    {
      name: 'tts_speak',
      description:
        'Speak text aloud through this machine\'s speakers. Uses the built-in OS voices by default and switches to ' +
        'GPT-SoVITS automatically once a voice pack is registered. Audio is not kept on disk unless you pass saveTo.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The words to speak.' },
          voice: {
            type: 'string',
            description: 'Voice pack name (GPT-SoVITS) or OS voice name (built-in). Omit for the configured default.',
          },
          engine: {
            type: 'string',
            enum: ['auto', 'builtin', 'gpt-sovits'],
            description: 'Force one engine. Omit to use the configured default.',
          },
          speed: { type: 'number', description: 'Speaking rate, 0.5 to 2.0. Defaults to the configured value.' },
          textLang: {
            type: 'string',
            description:
              'Language of the text, e.g. zh or en. Set it whenever the text is not in the configured language, ' +
              'or the words are tokenized as the wrong language and read as gibberish.',
          },
          saveTo: { type: 'string', description: 'Absolute path to keep the synthesized wav. Omit to discard it.' },
          forceOnboarding: {
            type: 'boolean',
            description: 'Ask the first-run setup questions again even if they were already answered.',
          },
        },
        required: ['text'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const result = value && typeof value === 'object' ? value : {}
          if (result.ok !== true) return [{ type: 'text', text: `Could not speak: ${result.reason || 'unknown error'}` }]
          const seconds = result.durationSeconds ? `${result.durationSeconds}s` : 'audio'
          const played = result.played ? 'played' : `played=false (${result.playError || 'playback skipped'})`
          return [{
            type: 'text',
            text: `Spoke ${seconds} via ${result.engine} (${result.voice}), ${played}: ${result.textPreview || ''}`,
          }]
        },
      },
      execute: (args, runtime) => speak(args || {}, runtime),
    },
    {
      name: 'tts_report',
      description:
        'Speak a progress report or summary aloud, shortened to a few seconds first. Use this INSTEAD of tts_speak ' +
        'whenever the text is longer than a sentence or two: a written report read in full takes far longer to hear ' +
        'than to read. The text is compressed locally by default (no extra model call), keeping the opening, the ' +
        'outcome, and any numbers. Returns the exact spoken text.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The report to summarize and speak. Markdown is fine.' },
          budget: {
            type: 'integer',
            description: 'Characters to keep. Defaults to the configured reportBudget (about 120, ~9 seconds).',
          },
          compress: {
            type: 'string',
            enum: ['local', 'subagent'],
            description: 'local (default, no extra model call) or subagent (an extra rewrite pass; use only if asked).',
          },
          voice: { type: 'string', description: 'Voice pack or OS voice name. Omit for the configured default.' },
          engine: {
            type: 'string',
            enum: ['auto', 'builtin', 'gpt-sovits'],
            description: 'Force one engine. Omit to use the configured default.',
          },
          textLang: {
            type: 'string',
            description:
              'Language of the report, e.g. zh or en. Set it whenever the report is not in the configured language.',
          },
          speed: { type: 'number', description: 'Speaking rate, 0.5 to 2.0.' },
          saveTo: { type: 'string', description: 'Absolute path to keep the synthesized wav.' },
          forceOnboarding: {
            type: 'boolean',
            description: 'Ask the first-run setup questions again even if they were already answered.',
          },
        },
        required: ['text'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const result = value && typeof value === 'object' ? value : {}
          if (result.ok !== true) return [{ type: 'text', text: `Could not report: ${result.reason || 'unknown error'}` }]
          const meta = result.report || {}
          const played = result.played ? 'played' : `played=false (${result.playError || 'playback skipped'})`
          return [{
            type: 'text',
            text:
              `Reported ${meta.spokenCharacters ?? '?'}/${meta.sourceCharacters ?? '?'} chars ` +
              `(${meta.strategy || '?'}) in ${result.durationSeconds || 0}s via ${result.engine} (${result.voice}), ${played}\n` +
              `spoken: ${meta.spokenText || ''}`,
          }]
        },
      },
      execute: (args, runtime) => report(args || {}, runtime),
    },
    {
      name: 'tts_engines',
      description:
        'Report which text-to-speech engines dsh-voice can use right now: the built-in OS voices, a local GPT-SoVITS ' +
        'checkout (with the model weights it found), or a remote GPT-SoVITS server. Also returns the active report ' +
        'persona (the soul/ notes and the voice pack it selects). Use it to diagnose a silent setup, and before ' +
        'speaking a report so the wording matches the persona.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const result = value && typeof value === 'object' ? value : {}
          const lines = []
          lines.push(`selected: ${result.selected || '(none)'} (configured: ${result.configured || 'auto'})`)
          lines.push(result.builtin?.available
            ? `built-in: available, ${result.builtin.voices} voice(s)`
            : `built-in: unavailable — ${result.builtin?.reason || 'unknown'}`)
          const gpt = result.gptSovits || {}
          lines.push(gpt.available
            ? `gpt-sovits: available (${gpt.mode}${gpt.engineRoot ? `, ${gpt.engineRoot}` : ''}${gpt.serverUrl ? `, ${gpt.serverUrl}` : ''})`
            : `gpt-sovits: unavailable — ${gpt.reason || 'not found'}`)
          lines.push(`voice packs: ${(result.voicePacks || []).length} in ${result.voicesDir || ''}`)
          if (result.persona?.file) {
            lines.push(`persona: ${result.persona.file} (voice: ${result.persona.voice || 'default'})`)
          } else if (result.persona?.dir) {
            lines.push(`persona: none in ${result.persona.dir}`)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      execute: (args, runtime) => engines(args || {}, runtime),
    },
    {
      name: 'tts_voices',
      description:
        'List or register voices. action=list shows registered GPT-SoVITS voice packs and the OS voices the built-in ' +
        'engine can use. action=add registers a pack from a reference wav, its transcript, and the two model weight paths.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add'], description: 'list (default) or add.' },
          name: { type: 'string', description: 'add: the pack name, used as the directory name and the voice id.' },
          refAudio: { type: 'string', description: 'add: path to a 3-10s clean reference wav you are allowed to use.' },
          promptText: { type: 'string', description: 'add: the exact transcript of that reference wav.' },
          gpt: { type: 'string', description: 'add: GPT checkpoint path relative to the engine root, e.g. GPT_weights_v4/voice-e10.ckpt.' },
          sovits: { type: 'string', description: 'add: SoVITS weight path relative to the engine root, e.g. SoVITS_weights_v4/voice_e10_s220.pth.' },
          version: { type: 'string', description: 'add: model version (v2ProPlus, v4, ...). Inferred from the weights paths when omitted.' },
          notice: { type: 'string', description: 'add: where this material came from and the terms you are working under, in your own words. A note for your records — it grants nothing.' },
          license: { type: 'string', description: 'add: accepted as an alias for notice, for callers written against older versions.' },
        },
        required: ['action'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const result = value && typeof value === 'object' ? value : {}
          if (result.ok !== true) return [{ type: 'text', text: `Could not handle voices: ${result.reason || 'unknown error'}` }]
          if (result.action === 'add') {
            return [{ type: 'text', text: `Registered voice pack "${result.name}" (${result.version}) in ${result.dir}${result.problem ? ` — ${result.note}` : ''}` }]
          }
          const packs = (result.packs || []).map((pack) => (pack.problem ? `${pack.name} (incomplete: ${pack.problem})` : pack.name))
          const os = (result.builtinVoices || []).map((voice) => voice.label || voice.id)
          return [{
            type: 'text',
            text: `voice packs: ${packs.join(', ') || '(none)'}\nOS voices: ${os.join('; ') || `(unavailable: ${result.builtinReason || 'unknown'})`}`,
          }]
        },
      },
      execute: (args, runtime) => voices(args || {}, runtime),
    },
    {
      name: 'tts_config',
      description:
        'Read or change dsh-voice settings without editing configuration files. action=read lists every key with its ' +
        'current value and its description; action=set changes one key. Use this instead of asking a user to edit a ' +
        'YAML: the settings live in a file the plugin owns, and the answer says whether the change applies now or at ' +
        'the next restart.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'set'], description: 'read (default) or set.' },
          key: {
            type: 'string',
            description:
              'set: the setting to change, e.g. defaultVoice, engine, speed, textLang, engines.gptSovits.engineRoot.',
          },
          value: {
            type: 'string',
            description: 'set: the new value. Passed as text; true/false and numbers are converted.',
          },
        },
        required: ['action'],
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const result = value && typeof value === 'object' ? value : {}
          if (result.ok !== true) return [{ type: 'text', text: `Config failed: ${result.reason || 'unknown error'}` }]
          if (result.action === 'set') {
            return [{ type: 'text', text: `${result.key} = ${JSON.stringify(result.value)} (applies ${result.effective})` }]
          }
          const rows = Object.entries(result.effective || {}).map(([key, val]) => {
            const shown = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val)
            return `  ${key}: ${shown}`
          })
          return [{ type: 'text', text: `settings file: ${result.path}\n${rows.join('\n')}` }]
        },
      },
      execute: (args, runtime) => configTool(args || {}, runtime),
    },
  ]
}
