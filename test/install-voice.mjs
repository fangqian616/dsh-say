/**
 * install-voice checks. Run: node test/install-voice.mjs
 *
 * The release bundle carries both the voice and the four base models inference
 * needs, which made the installer's file pick ambiguous: it took the first `.pth`
 * it found, and `s2Gv2ProPlus.pth` (a base model) sorts before
 * `silver-wolf_e10_s120.pth` (the voice). Nothing failed - the pack simply
 * registered a base model as its voice, which is the wrong voice and impossible to
 * notice without reading the registered paths.
 *
 * This drives the real installer against a scratch engine and asserts what it
 * registered, using tiny stand-in files so it runs anywhere.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

const scratch = mkdtempSync(join(tmpdir(), 'dsh-say-install-'))
const weights = join(scratch, 'weights')
const engine = join(scratch, 'engine')
const packs = join(scratch, 'packs')

// A faithful stand-in for the release layout: base models under bert/ and hubert/,
// the base checkpoints loose, and the voice's own files also loose. Contents are
// arbitrary bytes; only the names drive the pick.
const stub = (path, text = 'x') => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${text}:${path.split(/[\\/]/).pop()}`)
}

try {
  stub(join(weights, 's1v3.ckpt'), 'BASE-GPT')
  stub(join(weights, 's2Gv2ProPlus.pth'), 'BASE-SOVITS')
  stub(join(weights, 'silver-wolf-e10.ckpt'), 'VOICE-GPT')
  stub(join(weights, 'silver-wolf_e10_s120.pth'), 'VOICE-SOVITS')
  stub(join(weights, 'bert', 'config.json'), 'bert-config')
  stub(join(weights, 'bert', 'pytorch_model.bin'), 'bert-weights')
  stub(join(weights, 'hubert', 'config.json'), 'hubert-config')
  stub(join(weights, 'hubert', 'pytorch_model.bin'), 'hubert-weights')
  copyFileSync(join(root, 'voice', 'ref.wav'), join(weights, 'ref.wav'))
  copyFileSync(join(root, 'voice', 'ref.txt'), join(weights, 'ref.txt'))
  // The installer reads pack.json for the version and the notice.
  copyFileSync(join(root, 'voice', 'pack.json'), join(weights, 'pack.json'))
  mkdirSync(engine, { recursive: true })

  console.log('install-voice checks\n')
  console.log('1. it runs against the bundled layout')
  execFileSync(process.execPath, [
    join(root, 'scripts', 'install-voice.mjs'),
    '--engine', engine,
    '--weights', weights,
  ], {
    stdio: 'pipe',
    env: { ...process.env, DSH_VOICE_VOICES_DIR: packs },
  })

  const packPath = join(packs, 'silver-wolf', 'pack.json')
  check('a pack was registered', existsSync(packPath))
  const pack = JSON.parse(readFileSync(packPath, 'utf8'))

  console.log('\n2. the registered weights are the voice, not a base model')
  check('the GPT checkpoint is the voice', /silver-wolf-e10\.ckpt$/.test(pack.gpt), pack.gpt)
  check('the SoVITS weights are the voice', /silver-wolf_e10_s120\.pth$/.test(pack.sovits), pack.sovits)
  check('the SoVITS weights are not the base model',
    !/s2Gv2ProPlus/.test(pack.sovits),
    'the base model sorts first, so a name-blind pick lands on it')
  check('the GPT checkpoint is not the base model', !/s1v3/.test(pack.gpt))

  console.log('\n3. the base models landed in the engine, where it looks for them')
  for (const rel of [
    join('GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large', 'pytorch_model.bin'),
    join('GPT_SoVITS', 'pretrained_models', 'chinese-hubert-base', 'pytorch_model.bin'),
    join('GPT_SoVITS', 'pretrained_models', 's1v3.ckpt'),
    join('GPT_SoVITS', 'pretrained_models', 'v2Pro', 's2Gv2ProPlus.pth'),
  ]) {
    check(rel.replace(/\\/g, '/'), existsSync(join(engine, rel)))
  }
  check('the voice weights landed in the engine',
    existsSync(join(engine, 'GPT_weights_v2ProPlus', 'silver-wolf-e10.ckpt')))

  console.log('\n4. a second run does not overwrite the engine')
  writeFileSync(join(engine, 'GPT_SoVITS', 'pretrained_models', 's1v3.ckpt'), 'TOUCHED')
  execFileSync(process.execPath, [
    join(root, 'scripts', 'install-voice.mjs'),
    '--engine', engine,
    '--weights', weights,
  ], { stdio: 'pipe', env: { ...process.env, DSH_VOICE_VOICES_DIR: packs } })
  check('an existing base model is left alone',
    readFileSync(join(engine, 'GPT_SoVITS', 'pretrained_models', 's1v3.ckpt'), 'utf8') === 'TOUCHED')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
