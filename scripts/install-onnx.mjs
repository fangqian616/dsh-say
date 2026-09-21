/**
 * Install the ONNX engine (Genie-TTS) into a managed directory.
 *
 *   node scripts/install-onnx.mjs                 # CPU, the default
 *   node scripts/install-onnx.mjs --gpu           # try the CUDA build
 *   node scripts/install-onnx.mjs --check         # report without changing anything
 *
 * This is the route for someone with no GPT-SoVITS: it runs the same
 * GPT-SoVITS architecture through onnxruntime instead of PyTorch, which is
 * about 700 MB rather than 6.4 GB. It is still Python - the saving is PyTorch
 * and the CUDA toolkit, not the interpreter.
 *
 * Four steps, and three of them exist because the straightforward version fails
 * on a real machine:
 *
 *   1. a venv on a Python that onnxruntime actually publishes wheels for;
 *   2. a `jieba_fast` shim, because genie-tts depends on it unconditionally and
 *      it ships only as source, so `pip install genie-tts` needs MSVC otherwise;
 *   3. the Genie runtime data, which `import genie_tts` refuses to run without;
 *   4. a verification pass that reports the execution provider actually in use,
 *      because onnxruntime falls back to the CPU without saying so.
 *
 * Nothing here touches the user's global Python or their pip configuration: the
 * venv is self-contained and pip is pointed at a mirror per invocation.
 */

import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** PyPI, tried first, then a mirror. Order matters: a mirror must not be forced
 *  on everyone because it happens to be fast in one country. */
const PIP_INDEXES = [
  { label: 'PyPI', url: '' },
  { label: 'Tsinghua mirror', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
]

/** HuggingFace, then its mirror, for the same reason. */
const HF_ENDPOINTS = [
  { label: 'huggingface.co', url: 'https://huggingface.co' },
  { label: 'hf-mirror.com', url: 'https://hf-mirror.com' },
]

/** onnxruntime publishes no wheels past this minor version yet. */
const MAX_PYTHON_MINOR = 13
const MIN_PYTHON_MINOR = 9

// --- arguments --------------------------------------------------------------

function flagValue(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const config = {
  root: resolve(flagValue('--root', join(homedir(), '.dsh', 'voice-engines', 'genie'))),
  python: flagValue('--python', ''),
  gpu: process.argv.includes('--gpu'),
  check: process.argv.includes('--check'),
  skipData: process.argv.includes('--skip-data'),
  venvOnly: process.argv.includes('--venv-only'),
  voice: process.argv.includes('--voice'),
  voiceOnly: process.argv.includes('--voice-only'),
  noVoice: process.argv.includes('--no-voice'),
  withJapanese: process.argv.includes('--with-japanese'),
  from: flagValue('--from', ''),
}

const venv = join(config.root, 'venv')
const dataDir = join(config.root, 'GenieData')
const isWindows = process.platform === 'win32'
const venvPython = isWindows ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')

// --- helpers ----------------------------------------------------------------

function run(file, args, options = {}) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(file, args, { windowsHide: true, env: { ...process.env, ...(options.env || {}) }, cwd: options.cwd })
    } catch (error) {
      resolvePromise({ code: null, stdout: '', stderr: String(error?.message || error) })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
      if (options.echo) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
      if (options.echo) process.stderr.write(chunk)
    })
    child.on('error', (error) => resolvePromise({ code: null, stdout, stderr: `${stderr}${error?.message || error}` }))
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }))
  })
}

function pythonVersion(exe) {
  const probe = execFileSync(
    exe,
    ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'],
    { stdio: 'pipe', encoding: 'utf8' },
  )
  const [major, minor, patch] = probe.trim().split('.').map(Number)
  return { major, minor, patch, text: probe.trim() }
}

/** A Python new enough for genie-tts and old enough for onnxruntime wheels. */
function findPython() {
  const candidates = []
  if (config.python) candidates.push({ path: config.python, why: '--python' })
  if (process.env.DSH_VOICE_PYTHON) candidates.push({ path: process.env.DSH_VOICE_PYTHON, why: 'DSH_VOICE_PYTHON' })
  for (const name of ['python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3', 'python', 'py']) {
    candidates.push({ path: name, why: 'on PATH' })
  }
  // A conda environment named after the project, wherever conda lives.
  for (const manager of ['miniconda3', 'anaconda3', 'miniforge3']) {
    const base = join(homedir(), manager)
    if (!existsSync(base)) continue
    for (const env of ['gpt-sovits', 'base']) {
      const path = join(base, 'envs', env, isWindows ? 'python.exe' : 'bin/python')
      if (existsSync(path)) candidates.push({ path, why: `conda env ${env}` })
    }
  }

  const rejected = []
  for (const candidate of candidates) {
    let version
    try {
      version = pythonVersion(candidate.path)
    } catch {
      continue
    }
    if (version.major !== 3) {
      rejected.push(`${candidate.path} is Python ${version.text}`)
      continue
    }
    if (version.minor > MAX_PYTHON_MINOR || version.minor < MIN_PYTHON_MINOR) {
      rejected.push(`${candidate.path} is Python ${version.text} (need 3.${MIN_PYTHON_MINOR}-3.${MAX_PYTHON_MINOR})`)
      continue
    }
    return { ...candidate, version }
  }
  return { rejected }
}

/** Every `site-packages` under the venv, whichever layout the platform uses. */
function sitePackagesDirs() {
  const found = []
  const windowsLayout = join(venv, 'Lib', 'site-packages')
  if (existsSync(windowsLayout)) found.push(windowsLayout)
  const lib = join(venv, 'lib')
  if (existsSync(lib)) {
    for (const entry of readdirSync(lib)) {
      const candidate = join(lib, entry, 'site-packages')
      if (existsSync(candidate)) found.push(candidate)
    }
  }
  return found
}

/**
 * Install a `jieba_fast` that is actually `jieba`.
 *
 * It is a C extension distributed only as an sdist, so installing genie-tts on a
 * machine without MSVC fails at "Failed building wheel for jieba_fast". It is
 * also a drop-in for the pure-Python jieba, which is what genie-tts actually
 * calls (`cut_for_search`, `posseg`, `setLogLevel`) - so a package under that
 * name satisfies every call site.
 *
 * The `.dist-info` matters as much as the code: without it pip does not consider
 * the requirement met and tries to compile the real one anyway.
 */
function installJiebaShim() {
  const dirs = sitePackagesDirs()
  if (dirs.length === 0) return { ok: false, reason: 'no site-packages directory in the venv' }
  const target = dirs[0]

  const files = {
    'jieba_fast/__init__.py': `"""jieba_fast compatibility shim written by dsh-say.

jieba_fast is a C extension distributed only as source and needs a compiler to
install. genie-tts depends on it unconditionally, and uses only the API the
pure-Python jieba already provides, so this package re-exports that instead.
"""
import sys as _sys
import warnings as _warnings

import jieba as _jieba
from jieba import *  # noqa: F401,F403
from jieba import __version__  # noqa: F401
from jieba import cut, cut_for_search, lcut, lcut_for_search, setLogLevel  # noqa: F401

_warnings.filterwarnings("ignore", category=UserWarning, module="jieba_fast._compat")

from . import _compat  # noqa: E402,F401
from . import posseg  # noqa: E402,F401

_sys.modules[__name__ + ".posseg"] = posseg

__all__ = ["cut", "cut_for_search", "lcut", "lcut_for_search", "setLogLevel", "posseg"]
`,
    'jieba_fast/_compat.py': '"""Placeholder for jieba_fast._compat, which callers filter warnings on."""\n',
    'jieba_fast/posseg/__init__.py': `"""Re-export of jieba.posseg under the jieba_fast namespace."""
from jieba.posseg import *  # noqa: F401,F403
from jieba.posseg import dt, pair  # noqa: F401
`,
  }

  for (const [rel, body] of Object.entries(files)) {
    const path = join(target, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, 'utf8')
  }

  const distInfo = join(target, 'jieba_fast-0.53.dist-info')
  mkdirSync(distInfo, { recursive: true })
  writeFileSync(join(distInfo, 'METADATA'), `Metadata-Version: 2.1
Name: jieba_fast
Version: 0.53
Summary: Compatibility shim re-exporting jieba (written by dsh-say)
Requires-Python: >=3.8
Requires-Dist: jieba

dsh-say installs this because the real jieba_fast ships only as source and must
be compiled, while genie-tts depends on it unconditionally.
`, 'utf8')
  writeFileSync(join(distInfo, 'WHEEL'), 'Wheel-Version: 1.0\nGenerator: dsh-say\nRoot-Is-Purelib: true\nTag: py3-none-any\n', 'utf8')
  writeFileSync(join(distInfo, 'INSTALLER'), 'dsh-say\n', 'utf8')
  writeFileSync(join(distInfo, 'RECORD'), '', 'utf8')

  return { ok: true, target }
}

/** `pip install`, trying the default index and falling back to a mirror. */
async function pipInstall(packages, label) {
  const failures = []
  for (const index of PIP_INDEXES) {
    const args = ['-m', 'pip', 'install', ...packages]
    if (index.url) args.push('-i', index.url)
    console.log(`  pip install ${packages.join(' ')}  [${index.label}]`)
    const result = await run(venvPython, args, { echo: false })
    if (result.code === 0) return { ok: true, index: index.label }
    failures.push(`${index.label}: ${(result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' | ')}`)
    console.log(`    failed on ${index.label}${index.url ? ', trying the next index' : ''}`)
  }
  return { ok: false, reason: `${label} could not be installed.\n  ${failures.join('\n  ')}` }
}

const DOWNLOAD_DATA = `import os, sys
from huggingface_hub import snapshot_download
path = snapshot_download(
    repo_id="High-Logic/Genie",
    repo_type="model",
    allow_patterns="GenieData/*",
    local_dir=sys.argv[1],
    max_workers=4,
)
print("downloaded to " + path)
`

/** The Genie runtime data. `import genie_tts` raises without it. */
async function downloadData() {
  const failures = []
  for (const endpoint of HF_ENDPOINTS) {
    console.log(`  downloading Genie runtime data from ${endpoint.label} (~390 MB)`)
    const result = await run(venvPython, ['-c', DOWNLOAD_DATA, config.root], {
      env: { HF_ENDPOINT: endpoint.url, PYTHONIOENCODING: 'utf-8' },
    })
    if (result.code === 0) return { ok: true, endpoint: endpoint.label }
    failures.push(`${endpoint.label}: ${(result.stderr || '').trim().split('\n').slice(-2).join(' | ')}`)
    console.log(`    failed on ${endpoint.label}${endpoint !== HF_ENDPOINTS[HF_ENDPOINTS.length - 1] ? ', trying the mirror' : ''}`)
  }
  return { ok: false, reason: `the Genie runtime data could not be downloaded.\n  ${failures.join('\n  ')}` }
}

/**
 * The pyopenjtalk stand-in, written when Japanese support is not installed.
 *
 * Genie-TTS imports pyopenjtalk at load time — `GetPhonesAndBert.py` does
 * `from .G2P.Japanese.JapaneseG2P import japanese_to_phones` at module level — but
 * only calls it for Japanese text. Installing the real thing pulls
 * `pyopenjtalk-plus`, which brings `sudachidict_core`: 207 MB of Japanese
 * dictionaries plus 106 MB of library, for a language most voices never speak.
 *
 * So this satisfies the import and refuses the call. Every attribute returns
 * something that raises when used, which keeps a module-level reference in
 * JapaneseG2P loading while an actual Japanese synthesis fails with a message that
 * says what to install.
 *
 * `DSH_SAY_SHIM` is a real module attribute, not something __getattr__ fakes, so
 * the probe can tell this apart from the genuine package. A module-level name takes
 * precedence over __getattr__, which is what makes that work.
 */
const PYOPENJTAALK_SHIM = `"""pyopenjtalk is not installed, on purpose.

Genie-TTS imports it at load time but only calls it for Japanese text. The real
package pulls 207 MB of Sudachi dictionaries for a language this voice does not
use, so its absence is the default and its presence is a choice.

dsh-say writes this file during install-onnx.mjs. Run
\`node scripts/install-onnx.mjs --with-japanese\` to install the real thing.
"""

DSH_SAY_SHIM = True

_MESSAGE = (
    "Japanese speech is not installed. Run "
    "\`node scripts/install-onnx.mjs --with-japanese\` (about 317 MB), "
    "or set textLang to zh or en."
)


def _unavailable(*args, **kwargs):
    raise RuntimeError(_MESSAGE)


def __getattr__(name):
    return _unavailable
`

/** Write or remove the shim, or install the real package, per `--with-japanese`. */
async function installJapanese() {
  const dirs = sitePackagesDirs()
  if (dirs.length === 0) return { ok: false, reason: 'no site-packages directory in the venv' }
  const shim = join(dirs[0], 'pyopenjtalk.py')

  if (config.withJapanese) {
    rmSync(shim, { force: true })
    // The name is pyopenjtalk-plus on PyPI; it is the maintained fork that builds
    // on current Python, and it is what genie-tts depends on.
    const installed = await pipInstall(['pyopenjtalk-plus'], 'pyopenjtalk-plus')
    if (!installed.ok) {
      // Put the shim back rather than leaving the engine unable to import the
      // module at all: a broken install is worse than a limited one.
      writeFileSync(shim, PYOPENJTAALK_SHIM, 'utf8')
      return { ok: false, reason: `${installed.reason}\n  the stand-in was restored, so the engine still works without Japanese` }
    }
    return { ok: true, note: `installed (via ${installed.index}) — about 317 MB of it is dictionaries` }
  }

  writeFileSync(shim, PYOPENJTAALK_SHIM, 'utf8')
  // Any leftover from a previous --with-japanese run would otherwise keep the 317 MB
  // around while the shim shadows it.
  const leftovers = ['pyopenjtalk-plus', 'sudachidict_core', 'sudachipy']
  const present = await run(venvPython, ['-m', 'pip', 'show', '--files', ...leftovers])
  if (present.code === 0) {
    await run(venvPython, ['-m', 'pip', 'uninstall', '-y', ...leftovers])
    for (const dir of sitePackagesDirs()) {
      for (const name of ['pyopenjtalk', 'sudachidict_core', 'sudachipy', 'pyopenjtalk_plus.libs']) {
        rmSync(join(dir, name), { recursive: true, force: true })
      }
    }
  }
  return { ok: true, note: 'not installed (317 MB saved). Add --with-japanese if you need it.' }
}

/**
 * The voice archive: found locally, or fetched.
 *
 * `--voice` used to only look for a file the user had already downloaded, which
 * made "the plugin installs its own runtime and voice" not quite true - the voice
 * was one manual download away from being installed. It now fetches it, through the
 * same script and checksum that a user running fetch-voice.mjs by hand would get.
 */
async function resolveVoiceArchive() {
  const local = findVoiceArchive()
  if (local) return { ok: true, archive: local, source: 'found locally' }

  if (!config.voice) {
    return {
      ok: false,
      reason: 'no sample-onnx*.zip found. Pass --voice to download it, or --from "<path>" to point at one.',
    }
  }

  const staging = join(config.root, 'voice-download')
  console.log(`  not found locally; downloading (about 291 MB)`)
  const fetched = await run(process.execPath, [
    join(HERE, 'fetch-voice.mjs'),
    '--onnx',
    '--out', staging,
  ], { echo: true })

  if (fetched.code !== 0) {
    return {
      ok: false,
      reason:
        `the download failed (exit ${fetched.code}). Its checksum is checked against ` +
        'scripts/SOURCE.json, so a mismatch means the release asset is not what this ' +
        'version expects. Retry, or download it by hand and pass --from "<path>".',
    }
  }

  const archive = join(staging, 'sample-onnx-v2ProPlus.zip')
  if (!existsSync(archive)) {
    return { ok: false, reason: `the download reported success but ${archive} is not there` }
  }
  return { ok: true, archive, source: 'downloaded' }
}

/** Run the readiness probe that the plugin itself uses. */
async function verify() {
  const probe = join(HERE, '..', 'lib', 'engines', 'genie_probe.py')
  const result = await run(venvPython, [probe], {
    env: { GENIE_DATA_DIR: dataDir, PYTHONIOENCODING: 'utf-8' },
    cwd: config.root,
  })
  const line = (result.stdout || '').trim().split('\n').filter(Boolean).pop()
  if (!line) {
    return { ok: false, reason: `the engine did not answer the readiness probe${result.stderr ? `: ${result.stderr.trim().slice(-300)}` : ''}` }
  }
  try {
    return { ok: true, report: JSON.parse(line) }
  } catch {
    return { ok: false, reason: `the readiness probe produced unexpected output: ${line.slice(0, 200)}` }
  }
}

/** Every file under a directory, recursively. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** Unpack an archive. PowerShell on Windows, `unzip` elsewhere. */
function extractArchive(archive, into) {
  mkdirSync(into, { recursive: true })
  if (isWindows) {
    // Paths travel through the environment rather than the command line: quoting
    // a non-ASCII path into a PowerShell argument is how the earlier fetcher
    // ended up unable to find its own archive.
    execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
        'Expand-Archive -LiteralPath $env:DSH_ONNX_ARCHIVE -DestinationPath $env:DSH_ONNX_INTO -Force'],
      { stdio: 'pipe', env: { ...process.env, DSH_ONNX_ARCHIVE: archive, DSH_ONNX_INTO: into } },
    )
    return
  }
  execFileSync('unzip', ['-o', '-q', archive, '-d', into], { stdio: 'pipe' })
}

/** The ONNX voice archive, if it is already sitting somewhere obvious. */
function findVoiceArchive() {
  if (config.from) return resolve(config.from)
  const places = [
    join(homedir(), 'Downloads'),
    process.cwd(),
    join(process.env.TEMP || homedir(), 'dsh-voice-release'),
  ]
  const found = []
  for (const dir of places) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (/^sample-onnx.*\.zip$/i.test(name)) found.push(join(dir, name))
    }
  }
  // Newest wins: someone who downloaded twice means the second one.
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return found[0] || ''
}

/**
 * Install the ONNX voice into the voices directory.
 *
 * The archive is already in the finished layout - `onnx/`, `pack.json`, the
 * reference clip and its transcript - so installing is a copy into
 * `voice-packs/<name>/` and nothing else. That is deliberate: the pack that the
 * release produces is the same shape the plugin reads, so there is no conversion
 * step here that could disagree with it.
 */
function installVoice(archive) {
  const staging = join(config.root, 'voice-staging')
  rmSync(staging, { recursive: true, force: true })
  try {
    extractArchive(archive, staging)
  } catch (error) {
    return { ok: false, reason: `could not unpack ${archive}: ${String(error?.stderr || error?.message || error).slice(0, 300)}` }
  }

  const packFile = join(staging, 'pack.json')
  if (!existsSync(packFile) || !existsSync(join(staging, 'onnx'))) {
    return { ok: false, reason: `${basename(archive)} does not look like an ONNX voice archive (no pack.json and onnx/ at the top level)` }
  }

  let entry
  try {
    entry = JSON.parse(readFileSync(packFile, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    return { ok: false, reason: `pack.json in the archive is malformed: ${String(error?.message || error)}` }
  }

  const name = String(entry.name || 'sample').replace(/[^\w\u4e00-\u9fa5-]/g, '')
  const voicesDir = process.env.DSH_VOICE_VOICES_DIR || join(homedir(), '.dsh', 'voice-packs')
  const target = join(voicesDir, name)
  mkdirSync(target, { recursive: true })

  // Only the archive's own files move, and the model directory is replaced rather
  // than merged: a half-overwritten model directory produces a voice that loads
  // and sounds wrong, which is far worse than one that fails to load.
  rmSync(join(target, 'onnx'), { recursive: true, force: true })
  for (const file of walk(staging)) {
    const rel = file.slice(staging.length + 1)
    const dest = join(target, rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(file, dest)
  }
  const bytes = walk(join(target, 'onnx')).reduce((sum, file) => sum + statSync(file).size, 0)
  return { ok: true, name, dir: target, bytes }
}

/** Ask onnxruntime which provider a real session gets, not which one it offers. */
async function measureProvider() {
  const code = `import json, sys
import numpy as np, onnx
from onnx import TensorProto, helper
g = helper.make_graph(
    [helper.make_node("Add", ["a", "b"], ["c"])], "probe",
    [helper.make_tensor_value_info("a", TensorProto.FLOAT, [1]),
     helper.make_tensor_value_info("b", TensorProto.FLOAT, [1])],
    [helper.make_tensor_value_info("c", TensorProto.FLOAT, [1])])
m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)])
m.ir_version = 9
p = sys.argv[1]
onnx.save(m, p)
import onnxruntime as ort
s = ort.InferenceSession(p, providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
print(json.dumps({"providers": s.get_providers(), "available": ort.get_available_providers()}))
`
  const probePath = join(config.root, 'provider-probe.onnx')
  const result = await run(venvPython, ['-c', code, probePath], {
    env: { GENIE_DATA_DIR: dataDir, PYTHONIOENCODING: 'utf-8', DSH_SAY_CUDA_DLL_DIRS: process.env.DSH_SAY_CUDA_DLL_DIRS || '' },
    cwd: config.root,
  })
  try {
    rmSync(probePath, { force: true })
  } catch {
    /* best effort */
  }
  const line = (result.stdout || '').trim().split('\n').filter(Boolean).pop()
  if (!line) return { ok: false, reason: (result.stderr || '').trim().slice(-300) || 'no output' }
  try {
    return { ok: true, ...JSON.parse(line) }
  } catch {
    return { ok: false, reason: line.slice(0, 200) }
  }
}

// --- the run ----------------------------------------------------------------

console.log('dsh-say ONNX engine install')
console.log(`  root  : ${config.root}`)
console.log(`  mode  : ${config.gpu ? 'requesting the CUDA build' : 'CPU (default)'}`)

const existing = existsSync(venvPython)
if (existing) {
  console.log(`  venv  : already present`)
} else {
  console.log(`  venv  : will be created`)
}

// Installing the voice without touching the engine, for the two cases where the
// engine is already there: someone re-installing a voice, and the test suite,
// which must be able to exercise this path on a machine with no engine at all.
if (config.voiceOnly) {
  const resolved = await resolveVoiceArchive()
  if (!resolved.ok) {
    console.error(`--voice-only: ${resolved.reason}`)
    process.exit(1)
  }
  console.log(`\nvoice archive: ${resolved.archive}  (${resolved.source})`)
  const installed = installVoice(resolved.archive)
  if (!installed.ok) {
    console.error(`  ${installed.reason}`)
    process.exit(1)
  }
  console.log(`  installed "${installed.name}" into ${installed.dir}`)
  console.log(`  model: ${(installed.bytes / 1048576).toFixed(1)} MB`)
  process.exit(0)
}

if (config.check) {
  if (!existing) {
    console.log('\nthe engine is not installed. Run without --check to install it.')
    process.exit(1)
  }
  const report = await verify()
  if (!report.ok) {
    console.log(`\nnot ready: ${report.reason}`)
    process.exit(1)
  }
  console.log(`\npython      : ${report.report.pythonVersion}`)
  console.log(`onnxruntime : ${report.report.onnxruntime}`)
  console.log(`data        : ${report.report.dataDirExists ? 'present' : 'MISSING'}`)
  console.log(`build offers: ${(report.report.availableProviders || []).join(', ')}`)
  const provider = await measureProvider()
  if (provider.ok) {
    console.log(`a session gets: ${provider.providers.join(', ')}`)
    if (provider.providers.includes('CPUExecutionProvider') && provider.providers.length === 1 && config.gpu) {
      console.log('  -> CUDA was requested but the session fell back to the CPU. The plugin reports this too.')
    }
  } else {
    console.log(`a session gets: could not be determined (${provider.reason})`)
  }
  process.exit(0)
}

// 1. the interpreter
if (!existing) {
  const found = findPython()
  if (!found.path) {
    console.error('\nno usable Python found.')
    console.error(`  need Python 3.${MIN_PYTHON_MINOR} to 3.${MAX_PYTHON_MINOR}; onnxruntime publishes no wheels outside that range.`)
    for (const line of found.rejected || []) console.error(`  rejected: ${line}`)
    console.error('  install one from https://www.python.org/downloads/ and run this again,')
    console.error('  or point at one with --python "<path to python.exe>".')
    process.exit(1)
  }
  console.log(`\n1. interpreter\n  ${found.path} (${found.version.text}, ${found.why})`)
  mkdirSync(config.root, { recursive: true })
  const created = await run(found.path, ['-m', 'venv', venv])
  if (created.code !== 0 || !existsSync(venvPython)) {
    console.error(`  could not create a venv at ${venv}\n  ${(created.stderr || '').trim().slice(-400)}`)
    process.exit(1)
  }
  console.log(`  venv created at ${venv}`)
} else {
  console.log('\n1. interpreter\n  using the existing venv')
}

// 2. the shim, before anything tries to install the real jieba_fast
console.log('\n2. jieba_fast shim')
{
  const jieba = await pipInstall(['jieba'], 'jieba')
  if (!jieba.ok) {
    console.error(`  ${jieba.reason}`)
    process.exit(1)
  }
  const shim = installJiebaShim()
  if (!shim.ok) {
    console.error(`  ${shim.reason}`)
    process.exit(1)
  }
  console.log('  installed (genie-tts depends on a package that only ships as source)')
}

// 3. genie-tts, and optionally the CUDA build
console.log('\n3. genie-tts')
{
  const installed = await pipInstall(['genie-tts'], 'genie-tts')
  if (!installed.ok) {
    console.error(`  ${installed.reason}`)
    process.exit(1)
  }
  console.log(`  installed (via ${installed.index})`)
}

if (config.gpu) {
  console.log('\n3b. the CUDA build of onnxruntime')
  // genie-tts pins the CPU package, and the GPU package lags it by a version -
  // there is no onnxruntime-gpu matching 1.22.1 at all. So the CPU package is
  // removed and the closest GPU build takes its place. This is exactly the kind
  // of thing that quietly does not work, so the outcome is measured afterwards
  // rather than assumed.
  await run(venvPython, ['-m', 'pip', 'uninstall', '-y', 'onnxruntime'])
  const gpu = await pipInstall(['onnxruntime-gpu'], 'onnxruntime-gpu')
  if (!gpu.ok) {
    console.log(`  could not install the CUDA build; reinstalling the CPU one so the engine still works`)
    console.log(`  ${gpu.reason}`)
    await pipInstall(['onnxruntime==1.22.1'], 'onnxruntime')
  } else {
    console.log(`  installed ${gpu.index ? `(via ${gpu.index})` : ''} — whether it is used is checked at the end`)
  }
}

if (config.venvOnly) {
  console.log('\nstopping here: --venv-only was given.')
  process.exit(0)
}

// 3c. Japanese, which is off by default
console.log('\n3c. Japanese support')
{
  const japanese = await installJapanese()
  if (!japanese.ok) {
    console.error(`  ${japanese.reason}`)
    process.exit(1)
  }
  console.log(`  ${japanese.note}`)
}

// 4. the runtime data
console.log('\n4. Genie runtime data')
if (existsSync(join(dataDir, 'chinese-hubert-base')) && existsSync(join(dataDir, 'speaker_encoder.onnx'))) {
  console.log('  already present')
} else if (config.skipData) {
  console.log('  skipped (--skip-data). The engine cannot load a voice until this data exists.')
} else {
  const data = await downloadData()
  if (!data.ok) {
    console.error(`  ${data.reason}`)
    process.exit(1)
  }
  console.log(`  downloaded (via ${data.endpoint})`)
}

// 5. verify, and say what actually happened
console.log('\n5. verification')
const report = await verify()
if (!report.ok) {
  console.error(`  not ready: ${report.reason}`)
  process.exit(1)
}
console.log(`  python      : ${report.report.pythonVersion}`)
console.log(`  onnxruntime : ${report.report.onnxruntime}`)
console.log(`  data dir    : ${report.report.dataDirExists ? report.report.dataDir : 'MISSING'}`)

const provider = await measureProvider()
if (provider.ok) {
  const usingCuda = provider.providers.some((name) => /CUDA/i.test(name))
  console.log(`  build offers: ${(provider.available || []).join(', ')}`)
  console.log(`  a session gets: ${provider.providers.join(', ')}`)
  if (usingCuda) {
    console.log('  -> CUDA is live.')
  } else if (config.gpu) {
    console.log('')
    console.log('  -> CUDA was requested and the session fell back to the CPU.')
    console.log('     onnxruntime does this silently. To actually get the GPU it needs a CUDA 12')
    console.log('     and cuDNN 9 runtime on the DLL path: install nvidia-cudnn-cu12 and')
    console.log('     nvidia-cublas-cu12 into the venv, or point DSH_SAY_CUDA_DLL_DIRS at one.')
    console.log('     The plugin reports which one is in use, so nothing here is silent later.')
    console.log('     The CPU build is still several times faster than real time for speech.')
  } else {
    console.log('  -> CPU. Add --gpu later if you want to try the CUDA build.')
  }
} else {
  console.log(`  a session gets: could not be determined (${provider.reason})`)
}

console.log('\nthe engine is ready.')

// The voice is a separate thing from the engine, and the plugin says so
// everywhere else: the engine is the runtime, the voice is the material. It is
// installed here only when asked for, because a 290 MB download that the user did
// not ask for is exactly the behaviour the 6.4 GB rule exists to prevent.
if (!config.noVoice) {
  const wanted = config.voice || config.from
  if (wanted) {
    const resolved = await resolveVoiceArchive()
    if (!resolved.ok) {
      console.error(`\n${resolved.reason}`)
      process.exit(1)
    }
    console.log(`\n6. voice archive\n  ${resolved.archive}  (${resolved.source})`)
    const installed = installVoice(resolved.archive)
    if (!installed.ok) {
      console.error(`  ${installed.reason}`)
      process.exit(1)
    }
    console.log(`  installed "${installed.name}" into ${installed.dir}`)
    console.log(`  model: ${(installed.bytes / 1048576).toFixed(1)} MB`)
  }
}

console.log('\nnext:')
console.log('  node scripts/install-onnx.mjs --check              # re-report at any time')
console.log('  node scripts/install-onnx.mjs --voice              # find or download the sample voice')
console.log('  node scripts/install-onnx.mjs --with-japanese      # add Japanese (about 317 MB)')
console.log('  restart DSH so the plugin picks the engine up.')
