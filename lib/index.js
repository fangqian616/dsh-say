/**
 * dsh-say — give your DSH agent a voice.
 *
 * A cordis plugin that registers text-to-speech tools. The default backend is
 * whatever speech voices the operating system already has, so it works with no
 * download; installing GPT-SoVITS adds character voices and voice cloning.
 *
 * @module dsh-say
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Config, resolveConfig } from './config.js'
import { dispose as disposeOnnx, discover as discoverOnnx } from './engines/genie.js'
import { discover as discoverGptSovits } from './engines/gptsovits.js'
import { isOnboarded, onboard } from './onboarding.js'
import { readSettings, settingsPath } from './settings.js'
import { defineTools } from './tools.js'
import { audioDuration } from './util.js'
import { listVoicePacks } from './voice-store.js'

export { Config } from './config.js'

/** Plugin name, as it appears in a composition. */
export const name = 'voice'

/** Hard dependencies: the tool registry and the service used to play audio. */
export const inject = ['tools', 'shell']

/** The persona directory shipped beside this plugin. */
const shippedPersonaDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'soul')

/** Deep-merge user settings over the composition's config block. */
function mergeSettings(base, overrides) {
  if (overrides === undefined || overrides === null) return base
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return overrides
  if (typeof overrides !== 'object' || Array.isArray(overrides)) return overrides
  const out = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = key in base ? mergeSettings(base[key], value) : value
  }
  return out
}

/**
 * Register the voice tools.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} rawConfig parsed plugin configuration
 */
export function apply(ctx, rawConfig) {
  // The user's own file wins over the composition: onboarding writes there, and
  // asking someone to edit a profile YAML just to change a voice is the wrong
  // ergonomics. A deployment can still pin values in `config`.
  const config = resolveConfig(mergeSettings(rawConfig || {}, readSettings()))
  const personaDir = config.personaDir || shippedPersonaDir

  ctx.effect(() => {
    // Registered through `ctx.tools.register` with plain JSON Schema parameters.
    //
    // Wrapping these in `defineTool` looks right and is not: that helper takes a
    // parameterSchemaSpec - its own DSL - and rejects JSON Schema with
    // "parameters.type must be a value schema object". Passing raw JSON Schema
    // through it throws while the plugin is loading, so nothing mounts at all.
    // Every working plugin in this ecosystem registers the definition directly.
    const disposers = defineTools().map((definition) =>
      ctx.tools.register(
        {
          ...definition,
          execute: (args, execution) =>
            definition.execute(args, {
              config,
              personaDir,
              settingsPath,
              signal: execution?.signal,
              agent: execution?.agent,
              // Only the report tool reaches for a service, and only when the
              // caller explicitly asks for the subagent strategy.
              get: (name) => ctx.get(name),
              needsOnboarding: !isOnboarded(),
              // Onboarding is deferred to the first tool call on purpose: a
              // question cannot be answered while the runtime is still booting.
              onboard: ({ force }) => {
                if (!force && isOnboarded()) return { status: 'already-done' }
                const packs = listVoicePacks({ voicesDir: config.voicesDir })
                const healthy = packs.find((pack) => !pack.problem)
                // Both engines are checked before the questions are written: which
                // of them can run here is what decides whether the user is offered
                // an engine choice at all, and which option is worth recommending.
                return Promise.all([
                  discoverGptSovits(config.engines.gptSovits, { force: true }),
                  discoverOnnx(config.engines.onnx, { force: true }),
                ]).then(([gpt, onnx]) => onboard({
                  userQuestions: ctx.get('userQuestions'),
                  agent: execution?.agent,
                  installedVoice: healthy ? healthy.name : '',
                  installedVoiceEngines: healthy?.engines || [],
                  engineAvailable: gpt?.available === true,
                  engineRoot: gpt?.engineRoot || '',
                  engineBusyReason: gpt?.reason || '',
                  onnxAvailable: onnx?.available === true,
                  onnxReason: onnx?.reason || '',
                  onnxDevice: (onnx?.availableProviders || []).some((name) => /CUDA/i.test(name)) ? 'cuda' : 'cpu',
                  signal: execution?.signal,
                }))
              },
              measureDuration: (file) => audioDuration(file),
            }),
        },
      ),
    )
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* already gone */
        }
      }
    }
  }, 'dsh-say: tools')

  ctx.logger?.info?.(`dsh-say ready — engine: ${config.engine}, voices: ${config.voicesDir}, personas: ${personaDir}`)

  // Look for the engines at load, not only at the first tool call.
  //
  // Two reasons. The log line above already claims which engine is in use, and
  // without this it says `auto` whether or not anything can serve a character
  // voice - a claim the plugin cannot back. And a user who installs the plugin and
  // walks away should be able to read the log and learn that GPT-SoVITS is missing,
  // rather than discovering it when the first report comes out in a system voice.
  //
  // Detection only. Nothing is downloaded and no question is asked: a question at
  // boot has no one to answer it, which is why onboarding is deferred to the first
  // call. The result is cached, so the first call does not pay for it twice.
  void Promise.all([
    discoverGptSovits(config.engines.gptSovits, { force: true }),
    discoverOnnx(config.engines.onnx, { force: true }),
  ]).then(([gpt, onnx]) => {
    if (gpt?.available === true) {
      ctx.logger?.info?.(`dsh-say: GPT-SoVITS ready at ${gpt.engineRoot || gpt.serverUrl} (${gpt.version})`)
    } else {
      ctx.logger?.info?.(`dsh-say: no GPT-SoVITS checkout (${gpt?.reason || 'not found'})`)
    }
    if (onnx?.available === true) {
      // The provider is stated because onnxruntime falls back to the CPU in
      // silence: a user who installed the CUDA build deserves to know whether
      // they are getting it, and the log is where they will look.
      const cuda = (onnx.availableProviders || []).some((name) => /CUDA/i.test(name))
      ctx.logger?.info?.(
        `dsh-say: ONNX engine ready (${onnx.python}, onnxruntime ${onnx.onnxruntime}, ` +
        `${cuda ? 'CUDA build' : 'CPU-only build'}, requested: ${onnx.device})`,
      )
    } else {
      ctx.logger?.info?.(`dsh-say: no ONNX engine (${onnx?.reason || 'not found'})`)
    }
    if (gpt?.available !== true && onnx?.available !== true) {
      ctx.logger?.warn?.(
        'dsh-say: no character-voice engine is installed, so only the system voices can speak. ' +
        'The agent will offer the two install routes on the first voice request.',
      )
    }
  }).catch(() => {
    // A detection failure must never break loading: the built-in engine still works,
    // and the first tool call retries with the explanation.
    ctx.logger?.warn?.('dsh-say: could not check for a character-voice engine at load; the built-in engine still works')
  })

  // The ONNX engine keeps a Python process alive between calls, because the model
  // load is the expensive part. That process has to go when the plugin does.
  ctx.effect(() => disposeOnnx, 'dsh-say: onnx worker')
}
