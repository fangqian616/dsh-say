/**
 * dsh-say — give your DSH agent a voice.
 *
 * A cordis plugin that registers text-to-speech tools. The default backend is
 * whatever speech voices the operating system already has, so it works with no
 * download; installing GPT-SoVITS adds character voices and voice cloning.
 *
 * @module dsh-say
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Config, resolveConfig } from './lib/config.js'
import { isOnboarded, onboard } from './lib/onboarding.js'
import { readSettings, settingsPath } from './lib/settings.js'
import { defineTools } from './lib/tools.js'
import { audioDuration } from './lib/util.js'
import { listVoicePacks } from './lib/voice-store.js'

export { Config } from './lib/config.js'

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
    const disposers = defineTools().map((definition) =>
      ctx.tools.register(
        defineTool({
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
                return onboard({
                  userQuestions: ctx.get('userQuestions'),
                  agent: execution?.agent,
                  installedVoice: healthy ? healthy.name : '',
                  signal: execution?.signal,
                })
              },
              measureDuration: (file) => audioDuration(file),
            }),
        }),
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
}
