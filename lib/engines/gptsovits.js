/**
 * Optional engine: a local GPT-SoVITS installation.
 *
 * GPT-SoVITS is not bundled and never will be: the project ships no weights.
 * This engine drives a GPT-SoVITS the user already has, in either of two modes:
 *
 *   local   spawn `api_v2.py` from a GPT-SoVITS checkout, start it if needed,
 *           and synthesize over its local HTTP API;
 *   server  synthesize against a GPT-SoVITS API that is already running
 *           somewhere else, so a thin client needs no engine at all.
 *
 * @module dsh-say/lib/engines/gptsovits
 */

import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { cleanup, runCommand, tempWav, workDir } from '../util.js'

const ENGINE_NAME = 'gpt-sovits'
const API_PORT = 9880
const DEFAULT_SERVER = 'http://127.0.0.1:9880'

/**
 * The Python helper. It owns engine startup and the synthesis call so the Node
 * side stays small and every failure is reported as one JSON object.
 */
const HELPER_SOURCE = `#!/usr/bin/env python3
"""dsh-say helper: synthesize one line with GPT-SoVITS.

Written by dsh-say on demand; safe to delete. Reads a JSON request from
--stdin and prints one JSON object to stdout. Never raises: every failure is
reported as {"ok": false, "reason": "..."}.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request


def emit(payload):
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    sys.stdout.buffer.flush()


def api_listening(base, timeout=2.0):
    try:
        urllib.request.urlopen(base + "/control", timeout=timeout)
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False
    return True


def wait_listening(base, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if api_listening(base):
            return True
        time.sleep(1.5)
    return api_listening(base)


def write_api_config(request):
    engine = request["engine"]
    lines = [
        "custom:",
        "  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large",
        "  cnhuhbert_base_path: GPT_SoVITS/pretrained_models/chinese-hubert-base",
        "  device: " + str(engine.get("device", "cuda")),
        "  is_half: " + ("true" if engine.get("isHalf", True) else "false"),
        '  t2s_weights_path: "%s"' % engine["gpt"],
        "  version: " + str(engine.get("version", "v2ProPlus")),
        '  vits_weights_path: "%s"' % engine["sovits"],
    ]
    with open(request["apiConfig"], "w", encoding="utf-8") as handle:
        handle.write("\\n".join(lines) + "\\n")


def start_engine(request):
    write_api_config(request)
    python = request["python"]
    if not os.path.exists(python):
        return False, "python not found at " + python
    api_script = os.path.join(request["engineRoot"], "api_v2.py")
    if not os.path.exists(api_script):
        return False, "api_v2.py not found in " + request["engineRoot"]
    log = open(request["apiLog"], "ab")
    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
    try:
        import subprocess
        subprocess.Popen(
            [python, "api_v2.py", "-c", request["apiConfig"], "-a", "127.0.0.1", "-p", str(request["apiPort"])],
            cwd=request["engineRoot"],
            stdout=log,
            stderr=log,
            stdin=subprocess.DEVNULL,
            creationflags=flags,
        )
    except Exception as error:  # pragma: no cover - environment dependent
        log.close()
        return False, "could not start api_v2.py: %r" % (error,)
    log.close()
    if wait_listening(request["serverUrl"], 240):
        return True, ""
    return False, "api_v2.py did not start listening within 240s; see " + request["apiLog"]


def build_tts_payload(request):
    pack = request["pack"]
    return {
        "text": request["text"],
        "text_lang": request.get("textLang", "zh"),
        "ref_audio_path": pack["reference"],
        "prompt_text": pack["promptText"],
        "prompt_lang": request.get("promptLang", "zh"),
        "top_k": int(request.get("topK", 15)),
        "top_p": float(request.get("topP", 1)),
        "temperature": float(request.get("temperature", 1)),
        "text_split_method": request.get("textSplitMethod", "cut5"),
        "batch_size": 1,
        "speed_factor": float(request.get("speed", 1)),
        "seed": int(request.get("seed", -1)),
        "media_type": "wav",
        "streaming_mode": False,
        "parallel_infer": True,
        "repetition_penalty": float(request.get("repetitionPenalty", 1.35)),
        "sample_steps": int(request.get("sampleSteps", 32)),
        "super_sampling": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdin", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    with open(args.stdin, "r", encoding="utf-8-sig") as handle:
        request = json.load(handle)

    base = request["serverUrl"].rstrip("/")

    if request.get("mode") == "local" and not api_listening(base):
        ok, reason = start_engine(request)
        if not ok:
            emit({"ok": False, "reason": reason})
            return

    if not api_listening(base):
        emit({"ok": False, "reason": "no GPT-SoVITS API at " + base})
        return

    body = json.dumps(build_tts_payload(request)).encode("utf-8")
    http_request = urllib.request.Request(
        base + "/tts",
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    started = time.time()
    try:
        with urllib.request.urlopen(http_request, timeout=int(request.get("timeoutSeconds", 900))) as response:
            audio = response.read()
    except urllib.error.HTTPError as error:
        emit({"ok": False, "reason": "HTTP %s: %s" % (error.code, error.read().decode("utf-8", "ignore")[:400])})
        return
    except Exception as error:
        emit({"ok": False, "reason": repr(error)})
        return

    with open(args.out, "wb") as handle:
        handle.write(audio)

    emit({"ok": True, "audio": args.out, "bytes": len(audio), "elapsedSeconds": round(time.time() - started, 1)})


if __name__ == "__main__":
    main()
`

/** Write the helper script (idempotent) and return its path. */
function ensureHelper() {
  const path = join(workDir(), 'gptsovits_helper.py')
  writeFileSync(path, HELPER_SOURCE, 'utf8')
  return path
}

/** Candidate GPT-SoVITS checkouts, most specific first. */
function rootCandidates(configured) {
  const candidates = []
  if (configured) candidates.push(configured)
  if (process.env.DSH_VOICE_ENGINE_ROOT) candidates.push(process.env.DSH_VOICE_ENGINE_ROOT)
  // Generic locations only. A path specific to the maintainer's machine would
  // be dead weight for every other user, and misleading when it half-matches.
  candidates.push(join(homedir(), 'GPT-SoVITS'))
  candidates.push(join(homedir(), 'GPT-SoVITS-main'))
  candidates.push(join(homedir(), 'gpt-sovits'))
  candidates.push('C:\\GPT-SoVITS')
  candidates.push('D:\\GPT-SoVITS')
  return candidates
}

/** True when a directory looks like a GPT-SoVITS checkout. */
function looksLikeEngine(root) {
  try {
    return existsSync(join(root, 'api_v2.py')) && existsSync(join(root, 'GPT_SoVITS', 'pretrained_models'))
  } catch {
    return false
  }
}

/** Candidate Python interpreters for a checkout, most specific first. */
function pythonCandidates(root, configured) {
  const candidates = []
  if (configured) candidates.push(configured)
  if (process.env.DSH_VOICE_PYTHON) candidates.push(process.env.DSH_VOICE_PYTHON)
  candidates.push(join(root, '.venv', 'Scripts', 'python.exe'))
  candidates.push(join(root, 'venv', 'Scripts', 'python.exe'))
  candidates.push(join(root, '.venv', 'bin', 'python'))
  candidates.push(join(root, 'venv', 'bin', 'python'))
  // A conda environment named after the project, wherever conda lives. Derived
  // from the home directory rather than a hardcoded user path.
  for (const manager of ['miniconda3', 'anaconda3', 'miniforge3']) {
    candidates.push(join(homedir(), manager, 'envs', 'gpt-sovits', 'python.exe'))
    candidates.push(join(homedir(), manager, 'envs', 'gpt-sovits', 'bin', 'python'))
  }
  candidates.push('python')
  candidates.push('python3')
  return candidates
}

/** Trailing version segment of a weights directory name, e.g. `GPT_weights_v2ProPlus` -> `v2ProPlus`. */
export function versionFromDirName(name) {
  const match = /^[A-Za-z]+_weights_?(.*)$/.exec(name || '')
  return match && match[1] ? match[1] : 'v2ProPlus'
}

/**
 * Scan a checkout for model weights, so `tts engines` can tell a user exactly
 * which paths to put in a voice pack.
 */
export function scanWeights(engineRoot) {
  const found = { gpt: [], sovits: [] }
  let entries = []
  try {
    entries = readdirSync(engineRoot)
  } catch {
    return found
  }
  for (const entry of entries) {
    const dir = join(engineRoot, entry)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    if (entry.startsWith('GPT_weights')) {
      for (const file of safeFiles(dir)) {
        if (file.endsWith('.ckpt')) found.gpt.push({ version: versionFromDirName(entry), rel: `${entry}/${file}` })
      }
    } else if (entry.startsWith('SoVITS_weights')) {
      for (const file of safeFiles(dir)) {
        if (file.endsWith('.pth')) found.sovits.push({ version: versionFromDirName(entry), rel: `${entry}/${file}` })
      }
    }
  }
  return found
}

function safeFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isFile()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

/** Read a JSON endpoint, or report why it could not be read. */
async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const text = await response.text()
    try {
      return { ok: true, value: JSON.parse(text) }
    } catch {
      return { ok: false, reason: `unexpected response from ${url}` }
    }
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) }
  } finally {
    clearTimeout(timer)
  }
}

let discoveryCache

/**
 * Decide how (and whether) this engine can run.
 *
 * @param {object} config resolved plugin configuration
 * @param {{ force?: boolean }} [options]
 */
export async function discover(config, options = {}) {
  if (discoveryCache && !options.force) return discoveryCache

  const serverUrl = String(config.serverUrl || '').replace(/\/+$/, '')

  if (serverUrl) {
    const probe = await fetchJson(`${serverUrl}/control`)
    discoveryCache = {
      engine: ENGINE_NAME,
      available: true,
      mode: 'server',
      serverUrl,
      reason: probe.ok ? '' : `API at ${serverUrl} is not responding yet; it will be used as-is on the first call`,
    }
    return discoveryCache
  }

  for (const root of rootCandidates(config.engineRoot)) {
    if (!looksLikeEngine(root)) continue
    const version = config.version || 'v2ProPlus'
    const weights = scanWeights(root)
    const python = pythonCandidates(root, config.python).find((candidate) => candidate === 'python' || existsSync(candidate))
    discoveryCache = {
      engine: ENGINE_NAME,
      available: true,
      mode: 'local',
      engineRoot: root,
      python: python || 'python',
      version,
      serverUrl: DEFAULT_SERVER,
      apiPort: API_PORT,
      weights,
    }
    return discoveryCache
  }

  discoveryCache = {
    engine: ENGINE_NAME,
    available: false,
    mode: 'none',
    reason:
      'no GPT-SoVITS checkout found. Set engines.gptSovits.engineRoot (or DSH_VOICE_ENGINE_ROOT), or use the built-in engine instead.',
  }
  return discoveryCache
}

/** Drop the cached discovery, e.g. after the user installs an engine. */
export function forgetDiscovery() {
  discoveryCache = undefined
}

/**
 * Synthesize one line with a registered voice pack.
 *
 * @param {object} request
 * @param {string} request.text
 * @param {object} request.pack      a pack from the voice store
 * @param {object} request.config    resolved plugin configuration
 * @param {string} [request.outputPath]
 * @param {number} [request.speed]
 * @param {AbortSignal} [request.signal]
 */
export async function synthesize(request) {
  const { pack, config } = request
  if (!pack) return { ok: false, reason: 'no voice pack was resolved for this call' }
  if (pack.problem) return { ok: false, reason: `voice pack "${pack.name}" is incomplete: ${pack.problem}` }

  const status = await discover(config)
  if (!status.available) return { ok: false, reason: status.reason }
  if (status.mode === 'server') {
    return synthesizeOverServer({ ...request, serverUrl: status.serverUrl })
  }

  const output = request.outputPath || tempWav('gptsovits')
  const helper = ensureHelper()
  const requestPath = join(workDir(), `dsh-say-request-${Date.now()}-${process.pid}.json`)
  const payload = {
    mode: 'local',
    serverUrl: status.serverUrl,
    apiPort: status.apiPort,
    engineRoot: status.engineRoot,
    python: status.python,
    apiConfig: join(workDir(), 'gptsovits_api.yaml'),
    apiLog: join(workDir(), 'gptsovits_api.log'),
    pack: {
      name: pack.name,
      reference: pack.reference,
      promptText: pack.promptText,
    },
    engine: {
      gpt: pack.gpt,
      sovits: pack.sovits,
      version: pack.version || config.version || 'v2ProPlus',
      device: config.device || 'cuda',
      isHalf: config.isHalf !== false,
    },
    text: request.text,
    speed: typeof request.speed === 'number' ? request.speed : config.speed,
    textLang: config.textLang,
    promptLang: config.promptLang,
    sampleSteps: config.sampleSteps,
    timeoutSeconds: config.timeoutSeconds,
  }
  writeFileSync(requestPath, JSON.stringify(payload), 'utf8')

  try {
    const result = await runCommand(status.python, [helper, '--stdin', requestPath, '--out', output], {
      timeoutMs: (config.timeoutSeconds || 900) * 1000 + 60000,
      signal: request.signal,
    })
    const parsed = parseHelperOutput(result)
    if (!parsed.ok) {
      cleanup(output)
      return { ok: false, reason: parsed.reason }
    }
    return { ok: true, audio: parsed.audio || output, voice: pack.name, elapsedSeconds: parsed.elapsedSeconds, engineRoot: status.engineRoot }
  } finally {
    cleanup(requestPath)
  }
}

/** Synthesize against an already-running GPT-SoVITS API. */
async function synthesizeOverServer(request) {
  const { pack, config, serverUrl } = request
  const output = request.outputPath || tempWav('gptsovits')
  const body = JSON.stringify({
    text: request.text,
    text_lang: config.textLang,
    ref_audio_path: pack.reference,
    prompt_text: pack.promptText,
    prompt_lang: config.promptLang,
    top_k: 15,
    top_p: 1,
    temperature: 1,
    text_split_method: 'cut5',
    batch_size: 1,
    speed_factor: typeof request.speed === 'number' ? request.speed : config.speed,
    seed: -1,
    media_type: 'wav',
    streaming_mode: false,
    parallel_infer: true,
    repetition_penalty: 1.35,
    sample_steps: config.sampleSteps,
    super_sampling: false,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), (config.timeoutSeconds || 900) * 1000)
  try {
    const response = await fetch(`${serverUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return { ok: false, reason: `HTTP ${response.status}: ${detail.slice(0, 300)}` }
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0) return { ok: false, reason: 'the API returned an empty response' }
    writeFileSync(output, bytes)
    return { ok: true, audio: output, voice: pack.name, bytes: bytes.length }
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) }
  } finally {
    clearTimeout(timer)
  }
}

/** Turn the helper's stdout into a result object, keeping the failure detail. */
function parseHelperOutput(result) {
  const stdout = (result.stdout || '').trim()
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout)
      if (parsed && typeof parsed === 'object') {
        return parsed.ok ? parsed : { ok: false, reason: parsed.reason || 'synthesis failed' }
      }
    } catch {
      /* fall through to the diagnostic below */
    }
  }
  const stderr = (result.stderr || '').trim()
  return {
    ok: false,
    reason: `helper produced no result (exit ${result.code === null ? 'none' : result.code})${stderr ? `: ${stderr.slice(-400)}` : ''}`,
  }
}

/** Ask a running API whether it is up; used by `tts engines`. */
export async function probeServer(serverUrl) {
  const base = String(serverUrl || DEFAULT_SERVER).replace(/\/+$/, '')
  const probe = await fetchJson(`${base}/control`)
  return { listening: probe.ok, serverUrl: base }
}

export const engine = {
  name: ENGINE_NAME,
  label: 'GPT-SoVITS',
  synthesize,
  listVoices: async () => ({ available: true, voices: [] }),
  probe: (config) => discover(config),
  discover,
  scanWeights,
  versionFromDirName,
  probeServer,
}

export default engine
