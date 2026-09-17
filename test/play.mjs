/**
 * Playback and non-ASCII check. Run manually: node test/play.mjs
 *
 * Synthesizes the machine's own language sample and plays it, so a human can
 * confirm audio actually comes out of the default device. Kept out of
 * `smoke.mjs` because it is audible and slow.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import builtin from '../lib/engines/builtin.js'
import { speak } from '../lib/tools.js'

const config = {
  engine: 'builtin',
  voicesDir: join(homedir(), '.dsh', 'voice-packs'),
  defaultVoice: '',
  defaultVoiceBuiltin: '',
  speed: 1,
  textLang: 'zh',
  promptLang: 'zh',
  sampleSteps: 32,
  timeoutSeconds: 900,
  keepAudio: false,
  engines: { gptSovits: { serverUrl: '', engineRoot: '', python: '', version: 'v2ProPlus', device: 'cuda', isHalf: true } },
}

const voices = await builtin.listVoices()
const chinese = voices.voices.find((voice) => /zh|Chinese/i.test(voice.locale || '')) || voices.voices[0]
console.log(`voices: ${voices.voices.map((v) => v.label).join(' | ')}`)
console.log(`using:  ${chinese?.id || '(system default)'}`)

const text = '你好，这是 dsh-voice 的播放测试，音频正从默认输出设备播出来。'
console.log(`text:   ${text}`)

const result = await speak({ text, voice: chinese?.id, engine: 'builtin' }, { config })
console.log(JSON.stringify(result, null, 2))

if (!result.ok) {
  console.log('FAILED')
  process.exit(1)
}
if (!result.played) {
  console.log(`synthesized but did not play: ${result.playError}`)
  process.exit(1)
}
console.log('PLAYED — if you heard it, playback works end to end.')
