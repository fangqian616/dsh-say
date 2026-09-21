/**
 * ONNX engine checks: discovery, the worker protocol, and the honesty rules that
 * matter more here than in the other engines.
 *
 * The worker's `hello` op deliberately does not import genie_tts, so the
 * protocol half of this runs on any machine with a Python 3 - including CI,
 * which has no engine at all. The engine half reports and skips instead.
 *
 *   node test/genie.mjs
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import genie, { discover, engineOptions } from '../lib/engines/genie.js'
import { listVoicePacks } from '../lib/voice-store.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKER = join(HERE, '..', 'lib', 'engines', 'genie_worker.py')
const PROBE = join(HERE, '..', 'lib', 'engines', 'genie_probe.py')

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

/** A Python 3 on this machine, or null. */
function findPython() {
  const candidates = ['python', 'python3', 'py']
  if (process.env.DSH_VOICE_PYTHON) candidates.unshift(process.env.DSH_VOICE_PYTHON)
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-c', 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)'], { stdio: 'pipe' })
      return candidate
    } catch {
      /* try the next name */
    }
  }
  return null
}

console.log('dsh-say ONNX engine check')

console.log('\n1. it reads both configuration shapes')
const whole = { speed: 1.2, textLang: 'zh', engines: { onnx: { root: 'R', dataDir: 'D', device: 'cpu' } } }
const merged = engineOptions(whole)
check('a configured root survives', merged.root === 'R', merged.root)
check('a top-level key survives', merged.speed === 1.2, String(merged.speed))
check('the sub-block wins where both speak', engineOptions({ root: 'A', engines: { onnx: { root: 'B' } } }).root === 'B')

console.log('\n2. the Python files are valid')
const python = findPython()
if (python) {
  for (const script of [WORKER, PROBE]) {
    try {
      execFileSync(python, ['-m', 'py_compile', script], { stdio: 'pipe' })
      check(`${script.split(/[\\/]/).pop()} compiles`, true)
    } catch (error) {
      check(`${script.split(/[\\/]/).pop()} compiles`, false, String(error?.stderr || error?.message || error).slice(0, 200))
    }
  }
} else {
  console.log('     (no python on PATH — compilation not checked)')
}

console.log('\n3. the worker answers before it has an engine')
// `hello` must not import genie_tts: that import prints to stdout, prompts on
// stdin when its data directory is missing, and raises when hubert is absent.
// If it were imported here, this check would hang or fail on a clean machine.
if (python) {
  const reply = await new Promise((resolve) => {
    const child = spawn(python, [WORKER], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ timedOut: true, out, err })
    }, 30000)
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      err += chunk.toString('utf8')
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve({ out, err })
    })
    child.stdin.write(`${JSON.stringify({ id: 1, op: 'hello' })}\n`)
    child.stdin.write(`${JSON.stringify({ id: 2, op: 'shutdown' })}\n`)
  })

  check('the worker answers without an engine installed', reply.timedOut !== true, reply.err.slice(0, 200))
  const lines = (reply.out || '').trim().split('\n').filter(Boolean).map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  })
  check('every stdout line is protocol JSON, nothing else', lines.length >= 2 && lines.every(Boolean), (reply.out || '').slice(0, 200))
  check('hello replies to its own id', lines[0]?.id === 1 && lines[0]?.ok !== false, JSON.stringify(lines[0]).slice(0, 160))
  check('shutdown is acknowledged', lines[1]?.stopping === true, JSON.stringify(lines[1]))
} else {
  console.log('     (no python on PATH — worker protocol not checked)')
}

console.log('\n4. an unknown op is refused, not crashed')
if (python) {
  const out = await new Promise((resolve) => {
    const child = spawn(python, [WORKER], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    })
    let text = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(text)
    }, 30000)
    child.stdout.on('data', (chunk) => {
      text += chunk.toString('utf8')
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(text)
    })
    child.stdin.write('not json at all\n')
    child.stdin.write(`${JSON.stringify({ id: 7, op: 'nonsense' })}\n`)
    child.stdin.write(`${JSON.stringify({ id: 8, op: 'load', modelDir: '/no/such/dir', language: 'zh' })}\n`)
    child.stdin.write(`${JSON.stringify({ id: 9, op: 'shutdown' })}\n`)
  })
  const parsed = out.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  check('a malformed line is reported, not fatal', parsed.some((item) => /malformed request/.test(item.reason || '')))
  check('an unknown op is reported', parsed.some((item) => item.id === 7 && /unknown op/.test(item.reason || '')))
  check('a missing model directory is refused before importing genie', parsed.some((item) => item.id === 8 && /not found/.test(item.reason || '')), JSON.stringify(parsed.find((i) => i.id === 8)))
  check('the worker survived all of it', parsed.some((item) => item.id === 9 && item.stopping === true))
} else {
  console.log('     (no python on PATH — error handling not checked)')
}

console.log('\n5. a language it cannot speak is refused with the reason')
if (python) {
  const out = await new Promise((resolve) => {
    const child = spawn(python, [WORKER], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    })
    let text = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(text)
    }, 30000)
    child.stdout.on('data', (chunk) => {
      text += chunk.toString('utf8')
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(text)
    })
    child.stdin.write(`${JSON.stringify({ id: 1, op: 'load', modelDir: tmpdir(), language: 'ko' })}\n`)
    child.stdin.write(`${JSON.stringify({ id: 2, op: 'shutdown' })}\n`)
  })
  const parsed = out.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const refusal = parsed.find((item) => item.id === 1)
  check('Korean is refused', refusal?.ok === false, JSON.stringify(refusal))
  check('the refusal names the supported languages', /Chinese, English and Japanese/.test(refusal?.reason || ''), refusal?.reason)
} else {
  console.log('     (no python on PATH — language check not checked)')
}

console.log('\n6. discovery')
const status = await discover({ engines: { onnx: { root: '', python: '', dataDir: '', device: 'auto' } } }, { force: true })
console.log(`     available=${status.available} python=${status.python || '(none)'}`)
console.log(`     onnxruntime=${status.onnxruntime || '(none)'} providers=${(status.availableProviders || []).join(',') || '(none)'}`)
if (status.available) {
  check('an installed engine reports its interpreter', existsSync(status.python))
  check('the provider list is reported', Array.isArray(status.availableProviders))
} else {
  check('the refusal explains itself', typeof status.reason === 'string' && status.reason.length > 0, status.reason)
  check('the refusal says how to install it', /install-onnx/.test(status.reason || ''), status.reason)
}

console.log('\n7. it refuses a pack it cannot serve')
const packRefusal = await genie.synthesize({
  text: 'probe',
  pack: { name: 'no-onnx', dir: tmpdir(), onnx: '', onnxDir: '', problem: '' },
  config: { speed: 1, textLang: 'zh', engines: { onnx: { root: '', python: '', dataDir: '', device: 'auto' } } },
})
check('a pack with no ONNX model is refused', packRefusal.ok === false, packRefusal.reason)
check('the refusal names the alternative engine', /GPT-SoVITS/.test(packRefusal.reason || ''), packRefusal.reason)

console.log('\n8. a pack is judged on the models it actually has')
// The release archive carries an ONNX-only pack. Before this, `listVoicePacks`
// required gpt+sovits and marked exactly that pack as broken.
const voicesDir = join(tmpdir(), `dsh-say-onnx-packs-${Date.now()}`)
mkdirSync(join(voicesDir, 'onnx-only'), { recursive: true })
mkdirSync(join(voicesDir, 'torch-only'), { recursive: true })
mkdirSync(join(voicesDir, 'nothing'), { recursive: true })
writeFileSync(join(voicesDir, 'onnx-only', 'pack.json'), JSON.stringify({ name: 'onnx-only', onnx: 'onnx' }))
writeFileSync(join(voicesDir, 'onnx-only', 'ref.wav'), 'RIFF....WAVEfmt ')
writeFileSync(join(voicesDir, 'onnx-only', 'ref.txt'), '试听音频', 'utf8')
writeFileSync(join(voicesDir, 'torch-only', 'pack.json'), JSON.stringify({ name: 'torch-only', gpt: 'a.ckpt', sovits: 'b.pth' }))
writeFileSync(join(voicesDir, 'torch-only', 'ref.wav'), 'RIFF....WAVEfmt ')
writeFileSync(join(voicesDir, 'torch-only', 'ref.txt'), 'test', 'utf8')
writeFileSync(join(voicesDir, 'nothing', 'pack.json'), JSON.stringify({ name: 'nothing' }))
writeFileSync(join(voicesDir, 'nothing', 'ref.wav'), 'RIFF....WAVEfmt ')
writeFileSync(join(voicesDir, 'nothing', 'ref.txt'), 'test', 'utf8')

const packs = listVoicePacks({ voicesDir })
const onnxOnly = packs.find((pack) => pack.name === 'onnx-only')
const torchOnly = packs.find((pack) => pack.name === 'torch-only')
const nothing = packs.find((pack) => pack.name === 'nothing')
check('an ONNX-only pack is healthy', onnxOnly?.problem === '', onnxOnly?.problem)
check('its ONNX engines list says onnx', (onnxOnly?.engines || []).join(',') === 'onnx', (onnxOnly?.engines || []).join(','))
check('its model directory resolves inside the pack', (onnxOnly?.onnxDir || '').startsWith(voicesDir), onnxOnly?.onnxDir)
check('a PyTorch-only pack is still healthy', torchOnly?.problem === '', torchOnly?.problem)
check('a pack with no model at all is still rejected', /names no model/.test(nothing?.problem || ''), nothing?.problem)

rmSync(voicesDir, { recursive: true, force: true })

console.log('\n9. a pack can be registered against an ONNX model directory')
{
  const { voices } = await import('../lib/tools.js')
  const addDir = join(tmpdir(), `dsh-say-onnx-add-${Date.now()}`)
  const modelDir = join(tmpdir(), `dsh-say-onnx-model-${Date.now()}`)
  mkdirSync(modelDir, { recursive: true })
  const ref = join(tmpdir(), `dsh-say-onnx-ref-${Date.now()}.wav`)
  writeFileSync(ref, 'RIFF....WAVEfmt ')

  const ctx = { config: { voicesDir: addDir, engines: { gptSovits: { version: 'v2ProPlus' } } } }

  const noModel = await voices({ action: 'add', name: 'x', refAudio: ref }, ctx)
  check('a pack with neither model is refused', noModel.ok === false, noModel.reason)

  const missingDir = await voices({ action: 'add', name: 'x', refAudio: ref, onnx: join(tmpdir(), 'nope-not-here') }, ctx)
  check('a missing ONNX directory is refused', missingDir.ok === false, missingDir.reason)

  const added = await voices({ action: 'add', name: 'onnx-added', refAudio: ref, onnx: modelDir, promptText: '试听音频' }, ctx)
  check('an ONNX-only pack registers', added.ok === true, added.reason || added.note)
  check('and reports the engine it can run on', (added.engines || []).join(',') === 'onnx', (added.engines || []).join(','))
  check('the ONNX path is stored absolute', (added.problem || '') === '', added.problem)

  const listed = await voices({ action: 'list' }, ctx)
  const pack = (listed.packs || []).find((entry) => entry.name === 'onnx-added')
  check('it resolves back to the model directory', pack?.onnxDir === modelDir, `${pack?.onnxDir} vs ${modelDir}`)
  check('it is not reported as broken', !pack?.problem, pack?.problem)

  // A PyTorch pack must keep working exactly as before, and a pack carrying both
  // must be offered to both engines.
  const torch = await voices({ action: 'add', name: 'torch-added', refAudio: ref, gpt: 'GPT_weights_v4/a.ckpt', sovits: 'SoVITS_weights_v4/a.pth' }, ctx)
  check('a PyTorch-only pack still registers', torch.ok === true, torch.reason || torch.note)
  const both = await voices({ action: 'add', name: 'both', refAudio: ref, onnx: modelDir, gpt: 'GPT_weights_v4/a.ckpt', sovits: 'SoVITS_weights_v4/a.pth' }, ctx)
  check('a pack with both is offered to both engines', (both.engines || []).sort().join(',') === 'gpt-sovits,onnx', (both.engines || []).join(','))

  rmSync(addDir, { recursive: true, force: true })
  rmSync(modelDir, { recursive: true, force: true })
  rmSync(ref, { force: true })
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
