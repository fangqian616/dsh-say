/**
 * Shared primitives for dsh-say.
 *
 * Everything here is engine-agnostic: process spawning, temp paths, argument
 * quoting, and the `ffplay` playback used by engines that do not play audio
 * themselves.
 *
 * @module dsh-say/lib/util
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Per-process working directory, created on demand. */
export function workDir() {
  const dir = join(tmpdir(), 'dsh-say')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** A unique wav path inside the working directory. */
export function tempWav(tag) {
  const safe = String(tag || 'out').replace(/[^A-Za-z0-9_.-]/g, '_')
  return join(workDir(), `dsh-say-${safe}-${Date.now()}-${process.pid}.wav`)
}

/** Remove a file, ignoring a missing target. */
export function cleanup(path) {
  if (!path) return
  try {
    rmSync(path, { force: true })
  } catch {
    /* best effort */
  }
}

/**
 * Run a command to completion.
 *
 * Never throws on a non-zero exit: callers decide what an exit code means.
 * The abort signal resolves the promise early rather than rejecting, so a
 * cancelled tool call settles predictably.
 *
 * @param {string} file executable path
 * @param {string[]} args arguments
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ code: number|null, signal: string|null, stdout: string, stderr: string, timedOut: boolean }>}
 */
export function runCommand(file, args, options = {}) {
  const timeoutMs = options.timeoutMs || 120000
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(file, args, { windowsHide: true })
    } catch (error) {
      resolve({ code: null, signal: null, stdout: '', stderr: String(error), timedOut: false })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }, timeoutMs)

    const onAbort = () => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    }
    if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      stderr += String(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
      resolve({ code, signal, stdout, stderr, timedOut })
    })
  })
}

/**
 * Play one audio file through the machine's default output device and wait for
 * playback to finish, so a tool call does not return while audio is still
 * playing.
 *
 * @param {string} file wav path
 * @param {{ ffplayPath?: string, timeoutMs?: number, signal?: AbortSignal }} [options]
 */
export async function playFile(file, options = {}) {
  const ffplay = options.ffplayPath || 'ffplay'
  const result = await runCommand(
    ffplay,
    ['-nodisp', '-autoexit', '-loglevel', 'error', file],
    { timeoutMs: options.timeoutMs || 1800000, signal: options.signal },
  )
  if (result.code !== 0) {
    return {
      played: false,
      error: result.timedOut
        ? 'playback timed out'
        : `ffplay exited with ${result.code === null ? 'no code' : result.code}${result.stderr ? `: ${result.stderr.trim().slice(0, 300)}` : ''}`,
    }
  }
  return { played: true }
}

/** Duration of a media file in seconds, or 0 when it cannot be read. */
export async function audioDuration(file, options = {}) {
  const header = wavDuration(file)
  if (header > 0) return header
  const ffprobe = options.ffprobePath || 'ffprobe'
  const result = await runCommand(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { timeoutMs: 30000, signal: options.signal },
  )
  const value = Number.parseFloat((result.stdout || '').trim())
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
}

/**
 * Duration of a RIFF/WAVE file read straight from its header.
 *
 * Read locally so the built-in engine needs no external media tool at all; a
 * non-WAV or malformed file returns 0 and the caller may fall back to ffprobe.
 *
 * @param {string} file
 * @returns {number} seconds, rounded to 2 decimals, or 0
 */
export function wavDuration(file) {
  let buffer
  try {
    buffer = readFileSync(file)
  } catch {
    return 0
  }
  if (buffer.length < 44) return 0
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return 0

  let offset = 12
  let byteRate = 0
  let dataSize = 0
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (chunkId === 'fmt ' && body + 16 <= buffer.length) {
      byteRate = buffer.readUInt32LE(body + 8)
    } else if (chunkId === 'data') {
      dataSize = Math.min(chunkSize, buffer.length - body)
    }
    offset = body + chunkSize + (chunkSize % 2)
  }

  if (byteRate <= 0 || dataSize <= 0) return 0
  return Math.round((dataSize / byteRate) * 100) / 100
}

/** True when an executable resolves; used for capability probing. */
export async function hasCommand(command, args = ['-version']) {
  const result = await runCommand(command, args, { timeoutMs: 15000 })
  return result.code === 0
}
