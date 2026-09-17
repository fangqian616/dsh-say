/**
 * Voice discovery and registration.
 *
 * dsh-voice does not ship any voice. The built-in engine uses whatever voices
 * the operating system already has; the GPT-SoVITS engine uses voice packs the
 * user registers here, and each pack's reference audio is material the user is
 * responsible for being allowed to use.
 *
 * @module dsh-voice/lib/voice-store
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Read a JSON file, returning `undefined` when it is absent or malformed. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** All direct subdirectories of `dir`, or `[]` when it does not exist. */
export function listDirs(dir) {
  try {
    return readdirSync(dir)
      .filter((entry) => {
        try {
          return statSync(join(dir, entry)).isDirectory()
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

/** All `.wav` files directly inside `dir`, sorted by name. */
export function listWavs(dir) {
  try {
    return readdirSync(dir)
      .filter((entry) => entry.toLowerCase().endsWith('.wav'))
      .sort()
  } catch {
    return []
  }
}

/**
 * List registered GPT-SoVITS voice packs.
 *
 * A voice pack is a directory `voicesDir/<name>/` holding `pack.json` and one
 * or more reference wavs. Packs missing either are reported with a `problem`
 * so `tts voices` can explain what is wrong instead of silently hiding them.
 *
 * @param {{ voicesDir: string, defaultVoice?: string }} options
 */
export function listVoicePacks(options) {
  const { voicesDir } = options
  return listDirs(voicesDir).map((name) => {
    const dir = join(voicesDir, name)
    const pack = readJson(join(dir, 'pack.json'))
    const refs = listWavs(dir)
    const promptText = readPromptText(dir)
    const problems = []
    if (!pack) problems.push('pack.json missing or malformed')
    if (refs.length === 0) problems.push('no reference .wav in the pack directory')
    if (!promptText) problems.push('ref.txt (the exact transcript of the reference audio) is empty')
    if (pack && !pack.gpt) problems.push('pack.json has no "gpt" checkpoint path')
    if (pack && !pack.sovits) problems.push('pack.json has no "sovits" checkpoint path')
    return {
      name,
      dir,
      version: pack?.version || 'v2ProPlus',
      gpt: pack?.gpt || '',
      sovits: pack?.sovits || '',
      reference: refs.length > 0 ? join(dir, refs[0]) : join(dir, 'ref.wav'),
      promptText,
      license: pack?.license || '',
      problem: problems.length > 0 ? problems.join('; ') : '',
    }
  })
}

/** The reference transcript, preferring `ref.txt` then `prompt.txt`. */
function readPromptText(dir) {
  for (const candidate of ['ref.txt', 'prompt.txt']) {
    const path = join(dir, candidate)
    if (!existsSync(path)) continue
    try {
      return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim()
    } catch {
      return ''
    }
  }
  return ''
}

/** One registered pack by name, or `undefined`. */
export function findVoicePack(options, name) {
  if (!name) return undefined
  return listVoicePacks(options).find((pack) => pack.name === name)
}

/** The pack used when a call names no voice: the configured default, else the first healthy one. */
export function pickVoicePack(packs, preferred) {
  if (preferred) {
    const exact = packs.find((pack) => pack.name === preferred)
    if (exact) return exact
  }
  return packs.find((pack) => !pack.problem)
}

/** Ensure the voices directory exists so a user can drop a pack into it. */
export function ensureVoicesDir(voicesDir) {
  mkdirSync(voicesDir, { recursive: true })
  return voicesDir
}
