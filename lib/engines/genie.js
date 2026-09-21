/**
 * Optional engine: the ONNX build (Genie-TTS).
 *
 * This is the engine for someone who has no GPT-SoVITS. It runs the same
 * GPT-SoVITS architecture through onnxruntime instead of PyTorch, which turns a
 * 6.4 GB download into roughly 800 MB and needs no CUDA toolkit - but it is
 * still Python, and it is still a separate install.
 *
 * Two things this engine does that the others do not:
 *
 *   it keeps one Python process alive  the four ONNX sessions and the reference
 *     audio context cost seconds to build, so they are built once and reused;
 *
 *   it reports the provider it got  onnxruntime falls back to the CPU in
 *     silence when it cannot create a CUDA session, and the CPU is slower than
 *     the PyTorch engine this one is meant to replace. A silent fallback here is
 *     a feature that quietly does not work.
 *
 * @module dsh-say/lib/engines/genie
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, tempWav } from '../util.js'

const ENGINE_NAME = 'onnx'
const HERE = dirname(fileURLToPath(import.meta.url))
const WORKER_PATH = join(HERE, 'genie_worker.py')
const PROBE_PATH = join(HERE, 'genie_probe.py')

/** How long a worker is allowed to sit idle before it is shut down. */
const IDLE_MS = 10 * 60 * 1000

/**
 * Accept either the whole plugin config or just the `engines.onnx` block.
 *
 * Same reason as the GPT-SoVITS engine: the tool layer passes the whole config
 * because it also needs `speed` and `textLang`, while `index.js` passes the
 * sub-block. Every lookup here is `x || default`, so reading the wrong shape
 * would not fail - it would quietly ignore what the user configured.
 */
export function engineOptions(raw) {
  const full = raw || {}
  const block = full.engines?.onnx
  if (!block) return full
  return { ...full, ...block }
}

/** Environment the Python side needs: UTF-8 out, data directory pinned. */
function workerEnv(config) {
  return {
    ...process.env,
    // genie_tts prints an emoji warning at import. Under a GBK console that
    // raises UnicodeEncodeError and the process dies before it can answer.
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    GENIE_DATA_DIR: config.dataDir,
  }
}

// --- discovery --------------------------------------------------------------

let discoveryCache

/**
 * Decide how (and whether) the ONNX engine can run here.
 *
 * Runs the probe script rather than importing the package, because importing it
 * has side effects that a readiness check must not have.
 *
 * @param {object} rawConfig resolved plugin configuration, or its onnx block
 * @param {{ force?: boolean }} [options]
 */
export async function discover(rawConfig, options = {}) {
  if (discoveryCache && !options.force) return discoveryCache

  const config = engineOptions(rawConfig)
  const python = config.python

  if (!python || !existsSync(python)) {
    discoveryCache = {
      engine: ENGINE_NAME,
      available: false,
      reason:
        `the ONNX engine is not installed (no interpreter at ${python || '(unset)'}). ` +
        'Install it with: node scripts/install-onnx.mjs',
    }
    return discoveryCache
  }

  const probe = await runProbe(python, config)
  if (!probe.ok) {
    discoveryCache = { engine: ENGINE_NAME, available: false, reason: probe.reason }
    return discoveryCache
  }

  const report = probe.value
  if (report.genieTts !== true) {
    discoveryCache = {
      engine: ENGINE_NAME,
      available: false,
      python,
      reason:
        `the interpreter at ${python} has no genie-tts package. ` +
        'Install it with: node scripts/install-onnx.mjs',
    }
    return discoveryCache
  }
  if (report.dataDirExists !== true || (report.missing || []).length > 0) {
    const missing = (report.missing || []).join(', ')
    discoveryCache = {
      engine: ENGINE_NAME,
      available: false,
      python,
      dataDir: report.dataDir,
      reason:
        `the ONNX engine is missing its runtime data in ${report.dataDir}` +
        `${missing ? ` (${missing})` : ''}. Download it with: node scripts/install-onnx.mjs`,
    }
    return discoveryCache
  }

  discoveryCache = {
    engine: ENGINE_NAME,
    available: true,
    python,
    dataDir: report.dataDir,
    pythonVersion: report.pythonVersion,
    onnxruntime: report.onnxruntime,
    // Compiled in, not necessarily what a session gets. `synthesize` reports the
    // real answer; this is what the install placed.
    availableProviders: report.availableProviders || [],
    device: config.device || 'auto',
    // "installed" is the real pyopenjtalk, "stand-in" is the module dsh-say writes
    // in its place, "missing" is neither. Japanese needs the first.
    japanese: report.japanese || 'missing',
  }
  return discoveryCache
}

/** Drop the cached discovery, e.g. after the user installs the engine. */
export function forgetDiscovery() {
  discoveryCache = undefined
}

/** Run the readiness probe once and parse its single JSON line. */
function runProbe(python, config) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(python, [PROBE_PATH], { windowsHide: true, env: workerEnv(config), cwd: config.root })
    } catch (error) {
      resolve({ ok: false, reason: `could not run ${python}: ${String(error?.message || error)}` })
      return
    }

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }, 60000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, reason: `could not run ${python}: ${String(error?.message || error)}` })
    })
    child.on('close', () => {
      clearTimeout(timer)
      const line = stdout.trim().split('\n').filter(Boolean).pop()
      if (!line) {
        resolve({ ok: false, reason: `the ONNX probe produced no output${stderr ? `: ${stderr.trim().slice(-300)}` : ''}` })
        return
      }
      try {
        resolve({ ok: true, value: JSON.parse(line) })
      } catch {
        resolve({ ok: false, reason: `the ONNX probe produced unexpected output: ${line.slice(0, 200)}` })
      }
    })
  })
}

// --- the resident worker ----------------------------------------------------

/** The live worker, or undefined. One per process: the models are the expensive part. */
let worker

/**
 * Start the worker and hand back a client.
 *
 * Kept as a single module-level instance rather than per-configuration, because
 * a second worker would load a second copy of every model for no benefit.
 */
function startWorker(config) {
  const child = spawn(config.python, [WORKER_PATH], {
    windowsHide: true,
    env: workerEnv(config),
    // Genie resolves its own relative paths, so it runs from the engine root.
    cwd: config.root,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const client = {
    child,
    nextId: 1,
    pending: new Map(),
    stderrTail: [],
    idleTimer: undefined,
    dead: false,
    deadReason: '',
  }

  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) settle(client, line)
      newline = buffer.indexOf('\n')
    }
  })

  // Everything Genie prints lands here, including the import-time warnings.
  // Kept as a tail so a crash can be explained rather than just reported.
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8')
    client.stderrTail.push(text)
    if (client.stderrTail.length > 40) client.stderrTail.shift()
  })

  const die = (reason) => {
    if (client.dead) return
    client.dead = true
    client.deadReason = reason
    for (const entry of client.pending.values()) entry.reject(new Error(reason))
    client.pending.clear()
    if (worker === client) worker = undefined
  }

  child.on('error', (error) => die(`the ONNX engine process could not start: ${String(error?.message || error)}`))
  child.on('close', (code) => die(`the ONNX engine process exited with ${code === null ? 'no code' : code}${tail(client)}`))

  return client
}

/** Last few lines of the worker's stderr, for a failure message. */
function tail(client) {
  const text = (client.stderrTail || []).join('').trim()
  return text ? `: ${text.slice(-400)}` : ''
}

/** Resolve the pending promise for one protocol line. */
function settle(client, line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    // Not protocol. Genie or one of its dependencies printed to the wrong
    // stream; ignore it rather than failing the call in flight.
    client.stderrTail.push(line)
    return
  }
  const entry = client.pending.get(message.id)
  if (!entry) return
  client.pending.delete(message.id)
  entry.resolve(message)
}

/** Send one request and wait for its reply. */
function callWorker(config, op, payload = {}, options = {}) {
  if (!worker || worker.dead) worker = startWorker(config)
  const client = worker

  if (client.idleTimer) {
    clearTimeout(client.idleTimer)
    client.idleTimer = undefined
  }

  const id = client.nextId
  client.nextId += 1

  const timeoutMs = options.timeoutMs || 900000
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.pending.delete(id)
      reject(new Error(`the ONNX engine did not answer ${op} within ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    client.pending.set(id, {
      resolve: (message) => {
        clearTimeout(timer)
        resolve(message)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })

    try {
      client.child.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`)
    } catch (error) {
      clearTimeout(timer)
      client.pending.delete(id)
      reject(new Error(String(error?.message || error)))
    }
  })
}

/** Stop the worker, e.g. when the plugin unloads or the process exits. */
export function dispose() {
  const client = worker
  worker = undefined
  if (!client) return
  try {
    client.child.stdin.write(`${JSON.stringify({ id: 0, op: 'shutdown' })}\n`)
  } catch {
    /* already gone */
  }
  // The worker exits on its own; this is the backstop for a wedged one.
  const timer = setTimeout(() => {
    try {
      client.child.kill()
    } catch {
      /* ignore */
    }
  }, 2000)
  timer.unref?.()
}

// --- synthesis --------------------------------------------------------------

/** Character name used inside the worker. One worker serves one voice at a time. */
function characterName(pack) {
  return String(pack?.name || 'voice').replace(/[^A-Za-z0-9_.-]/g, '_')
}

/**
 * Synthesize one line with a registered voice pack.
 *
 * @param {object} request
 * @param {string} request.text
 * @param {object} request.pack      a pack from the voice store
 * @param {object} request.config    resolved plugin configuration
 * @param {string} [request.outputPath]
 * @param {AbortSignal} [request.signal]
 */
export async function synthesize(request) {
  const { pack } = request
  if (!pack) return { ok: false, reason: 'no voice pack was resolved for this call' }
  if (pack.problem) return { ok: false, reason: `voice pack "${pack.name}" is incomplete: ${pack.problem}` }
  if (!pack.onnxDir) {
    return {
      ok: false,
      reason:
        `voice pack "${pack.name}" has no ONNX model, so the ONNX engine cannot speak it. ` +
        'Either install it from the ONNX voice archive, or use the GPT-SoVITS engine instead.',
    }
  }
  if (!existsSync(pack.onnxDir)) {
    return { ok: false, reason: `the ONNX model directory for "${pack.name}" is missing: ${pack.onnxDir}` }
  }

  const config = engineOptions(request.config)
  const status = await discover(config)
  if (!status.available) return { ok: false, reason: status.reason }

  const output = request.outputPath || tempWav('onnx')
  const character = characterName(pack)
  const language = config.textLang || 'zh'

  // Caught here rather than left to the engine, so the failure names the command
  // that fixes it. Without this the same thing surfaces as a Python RuntimeError
  // from deep inside the phonemizer, which reads like a broken install instead of a
  // feature that was not included.
  if (language === 'ja' && status.japanese !== 'installed') {
    return {
      ok: false,
      reason:
        'Japanese speech is not installed for the ONNX engine. It is off by default because the ' +
        'dependencies are about 317 MB of Japanese dictionaries. Run ' +
        '`node scripts/install-onnx.mjs --with-japanese` to add it, or use textLang zh or en.',
    }
  }

  try {
    const load = await callWorker(config, 'load', {
      character,
      modelDir: pack.onnxDir,
      language,
      device: config.device || 'auto',
    }, { timeoutMs: 300000 })
    if (!load.ok) return { ok: false, reason: load.reason }

    const reference = await callWorker(config, 'reference', {
      character,
      audioPath: pack.reference,
      promptText: pack.promptText,
      language,
    }, { timeoutMs: 120000 })
    if (!reference.ok) return { ok: false, reason: reference.reason }

    const result = await callWorker(config, 'synth', {
      character,
      text: request.text,
      out: output,
    }, { timeoutMs: (config.timeoutSeconds || 900) * 1000 })
    if (!result.ok) {
      cleanup(output)
      return { ok: false, reason: result.reason }
    }

    return {
      ok: true,
      audio: result.audio || output,
      voice: pack.name,
      elapsedSeconds: result.elapsedSeconds,
      device: result.device || load.device || 'cpu',
      // Carried so the caller can say which route actually ran. The ONNX engine
      // has no speed control at all, and the user should not have to guess why
      // their `speed` setting did nothing.
      speedSupported: false,
      warning: config.speed && Math.abs(config.speed - 1) > 0.01
        ? 'the ONNX engine has no speed control, so this line was spoken at its natural rate'
        : undefined,
    }
  } catch (error) {
    cleanup(output)
    return { ok: false, reason: String(error?.message || error) }
  }
}

/** Report the provider the live sessions are actually using. */
export async function providers(config) {
  const resolved = engineOptions(config)
  try {
    const report = await callWorker(resolved, 'providers', {}, { timeoutMs: 30000 })
    return report.ok ? report : { ok: false, reason: report.reason }
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) }
  }
}

export const engine = {
  name: ENGINE_NAME,
  label: 'ONNX (Genie-TTS)',
  synthesize,
  listVoices: async () => ({ available: true, voices: [] }),
  probe: (config) => discover(config),
  discover,
  providers,
  dispose,
}

export default engine
