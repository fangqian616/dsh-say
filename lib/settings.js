/**
 * User settings that live outside the cordis composition.
 *
 * Editing a cordis YAML is the wrong thing to ask of someone who just wants to
 * hear a voice: the file lives in the deployment's profile directory, it holds
 * every other plugin's rows, and a mistake there breaks the profile rather than
 * one feature.
 *
 * So the plugin keeps its own settings file under the user's home directory and
 * treats it as the higher-precedence layer: onboarding writes it, `tts_config`
 * edits it, and the composition's `config` block stays available for a
 * deployment that wants to pin a value. Precedence is user file > composition >
 * built-in default, so what the user set by talking to the agent wins.
 *
 * @module dsh-say/lib/settings
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Where user settings live. */
export function settingsPath() {
  return process.env.DSH_VOICE_CONFIG || join(homedir(), '.dsh', 'voice', 'config.json')
}

/** Read the settings file, or `{}` when absent or unreadable. */
export function readSettings() {
  const path = settingsPath()
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Merge a patch into the settings file and return the new contents.
 *
 * Keys whose value is `undefined` are dropped rather than written, so clearing a
 * field means passing `null` or an empty string explicitly.
 */
export function writeSettings(patch) {
  const path = settingsPath()
  const next = { ...readSettings() }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value === null) delete next[key]
    else next[key] = value
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/** Settings keys the plugin understands, with a one-line description each. */
export const SETTING_KEYS = {
  engine: 'auto | builtin | gpt-sovits — which backend to prefer',
  defaultVoice: 'voice pack used when a call names none',
  defaultVoiceBuiltin: 'OS voice used when a call names none on the built-in engine',
  speed: 'speaking rate, 0.5 to 2.0',
  textLang: 'language of the text being spoken, e.g. zh or en',
  promptLang: 'language of a voice pack reference transcript',
  reportBudget: 'characters kept when speaking a report',
  sampleSteps: 'GPT-SoVITS sampling steps; lower is faster',
  keepAudio: 'keep generated wav files instead of deleting them',
  voicesDir: 'directory holding voice packs',
  personaDir: 'directory holding report personas',
  'engines.gptSovits.engineRoot': 'path to a GPT-SoVITS checkout',
  'engines.gptSovits.serverUrl': 'use a running GPT-SoVITS API instead of a local checkout',
  'engines.gptSovits.python': 'python interpreter for the local checkout',
  'engines.gptSovits.version': 'model version used when packing weights',
}

/**
 * Apply one dotted setting path to a patch object.
 *
 *   applySetting({}, 'engines.gptSovits.version', 'v4')
 *   // → { engines: { gptSovits: { version: 'v4' } } }
 */
export function applySetting(patch, key, value) {
  const parts = String(key).split('.')
  let cursor = patch
  for (const part of parts.slice(0, -1)) {
    if (typeof cursor[part] !== 'object' || cursor[part] === null) cursor[part] = {}
    cursor = cursor[part]
  }
  cursor[parts[parts.length - 1]] = value
  return patch
}

/** Read one dotted setting path from an object, or `undefined`. */
export function readSetting(source, key) {
  return String(key)
    .split('.')
    .reduce((cursor, part) => (cursor && typeof cursor === 'object' ? cursor[part] : undefined), source)
}
