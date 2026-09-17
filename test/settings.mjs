/**
 * Settings and `tts_config` checks. Run: node test/settings.mjs
 *
 * The point of this layer is that a user changes a voice by talking to the agent,
 * not by editing a cordis YAML. These checks pin the file, the precedence, and
 * the key handling, and they redirect the settings path so a test run cannot
 * rewrite the developer's own configuration.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'dsh-voice-settings-'))
process.env.DSH_VOICE_CONFIG = join(dir, 'config.json')
process.env.DSH_VOICE_STATE_DIR = join(dir, 'state')

const { SETTING_KEYS, applySetting, readSetting, readSettings, settingsPath, writeSettings } = await import('../lib/settings.js')
const { configTool } = await import('../lib/tools.js')
const { onboard, resetOnboarding } = await import('../lib/onboarding.js')

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

const ctx = {
  personaDir: '',
  config: {
    engine: 'auto',
    defaultVoice: '',
    defaultVoiceBuiltin: '',
    speed: 1,
    textLang: 'zh',
    promptLang: 'zh',
    sampleSteps: 32,
    reportBudget: 120,
    timeoutSeconds: 900,
    keepAudio: false,
    voicesDir: join(dir, 'voice-packs'),
    personaDir: '',
    engines: { gptSovits: { serverUrl: '', engineRoot: '', python: '', version: 'v2ProPlus', device: 'cuda', isHalf: true } },
  },
}

console.log('settings checks')
console.log(`  settings file: ${settingsPath()}`)

console.log('\n1. a fresh install has no settings file')
check('reading returns an empty object', Object.keys(readSettings()).length === 0)

console.log('\n2. writing merges instead of replacing')
const first = writeSettings({ defaultVoice: 'silver-wolf' })
check('the first key is stored', first.defaultVoice === 'silver-wolf')
const second = writeSettings({ speed: 1.2 })
check('the earlier key survives', second.defaultVoice === 'silver-wolf', JSON.stringify(second))
check('the new key is added', second.speed === 1.2)
check('the file parses as JSON', JSON.parse(readFileSync(settingsPath(), 'utf8')).speed === 1.2)

console.log('\n3. dotted paths nest correctly')
const patch = applySetting({}, 'engines.gptSovits.engineRoot', 'D:/GPT-SoVITS')
check('the path nests', readSetting(patch, 'engines.gptSovits.engineRoot') === 'D:/GPT-SoVITS', JSON.stringify(patch))
writeSettings(patch)
check('it round-trips through the file', readSetting(readSettings(), 'engines.gptSovits.engineRoot') === 'D:/GPT-SoVITS')

console.log('\n4. null removes a key, undefined leaves it alone')
writeSettings({ defaultVoiceBuiltin: 'Microsoft Zira Desktop' })
check('a value was set', readSettings().defaultVoiceBuiltin === 'Microsoft Zira Desktop')
writeSettings({ defaultVoiceBuiltin: null })
check('null removes it', readSettings().defaultVoiceBuiltin === undefined)
writeSettings({ speed: undefined })
check('undefined does not remove it', readSettings().speed === 1.2)

console.log('\n5. tts_config reads and writes')
const read = await configTool({ action: 'read' }, ctx)
check('read succeeds', read.ok === true)
check('it names the settings file', read.path === settingsPath())
check('it lists every key', Object.keys(read.keys).length === Object.keys(SETTING_KEYS).length)
check('it reports the effective values', read.effective.defaultVoice === 'silver-wolf')

const set = await configTool({ action: 'set', key: 'textLang', value: 'en' }, ctx)
check('set succeeds', set.ok === true, set.reason || '')
check('the value is coerced to a string', set.value === 'en')
check('it says when the change applies', typeof set.effective === 'string' && set.effective.length > 0, set.effective)

const boolSet = await configTool({ action: 'set', key: 'keepAudio', value: 'true' }, ctx)
check('"true" becomes a boolean', boolSet.value === true, String(boolSet.value))

const numSet = await configTool({ action: 'set', key: 'speed', value: '1.5' }, ctx)
check('"1.5" becomes a number', numSet.value === 1.5, String(numSet.value))

console.log('\n6. a bad key is refused with the valid ones listed')
const bad = await configTool({ action: 'set', key: 'notAKey', value: 'x' }, ctx)
check('an unknown key is refused', bad.ok === false)
check('the refusal lists valid keys', /defaultVoice|engine/.test(bad.reason || ''), bad.reason)

const noValue = await configTool({ action: 'set', key: 'speed' }, ctx)
check('a missing value is refused', noValue.ok === false)

console.log('\n7. onboarding writes the choice into settings')
rmSync(settingsPath(), { force: true })
const decided = await onboard({
  userQuestions: {
    ask: async () => ({
      answers: [
        { id: 'voice', selected: ['先用系统语音'], custom: '' },
        { id: 'soul', selected: ['用默认人设'], custom: '' },
        { id: 'report', selected: ['要，压缩后播报'], custom: '' },
      ],
    }),
  },
  agent: { id: 'test' },
  installedVoice: 'silver-wolf',
})
check('onboarding succeeded', decided.status === 'asked', decided.status)
const stored = readSettings()
check('choosing system speech pins the built-in engine', stored.engine === 'builtin', String(stored.engine))
check('auto-report is recorded', stored.autoReport === true)
check('the persona choice is recorded', stored.useSoul === true)

console.log('\n8. an import choice pins the pack instead')
// Clearing the settings file is not enough: the onboarding marker still says the
// questions were answered, and asking them twice is exactly what it prevents. So
// reset the marker too, or this section silently tests nothing.
rmSync(settingsPath(), { force: true })
resetOnboarding()
const reimported = await onboard({
  userQuestions: {
    ask: async () => ({
      answers: [
        { id: 'voice', selected: ['我要导入别的声线'], custom: '' },
        { id: 'soul', selected: ['不要人设'], custom: '' },
        { id: 'report', selected: ['不要自动播报'], custom: '' },
      ],
    }),
  },
  agent: { id: 'test' },
  installedVoice: 'silver-wolf',
})
check('onboarding ran again after the reset', reimported.status === 'asked', reimported.status)
const imported = readSettings()
check('importing pins the gpt-sovits engine', imported.engine === 'gpt-sovits', String(imported.engine))
check('it names the installed pack', imported.defaultVoice === 'silver-wolf', String(imported.defaultVoice))
check('"no persona" is recorded', imported.useSoul === false)
check('"no auto-report" is recorded', imported.autoReport === false)

console.log('\n9. asking twice is prevented, and the marker is what prevents it')
const again = await onboard({
  userQuestions: { ask: async () => { throw new Error('must not be asked again') } },
  agent: { id: 'test' },
})
check('a second run short-circuits', again.status === 'already-done', again.status)

rmSync(dir, { recursive: true, force: true })

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
