/**
 * Fetch and install the optional voice weights.
 *
 *   node scripts/fetch-voice.mjs                       # download using scripts/SOURCE.json
 *   node scripts/fetch-voice.mjs --from <archive.zip>   # use a local archive
 *   node scripts/fetch-voice.mjs --print-commands       # just show the install steps
 *
 * The weights are NOT in this repository on purpose: they are hundreds of
 * megabytes, they are non-commercial, and Git is a poor place for either. This
 * script puts them in voice/ and prints how to register the resulting pack.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const voiceDir = join(repoRoot, 'voice')
// The fetch configuration lives beside this script, not with the voice data: it
// describes where to get weights from, which is a scripting concern.
const sourcePath = join(repoRoot, 'scripts', 'SOURCE.json')

/**
 * The user's HTTP proxy, or '' when traffic goes direct.
 *
 * Node's `fetch` does not read the proxy environment variables unless it is given
 * a dispatcher, and this package has no dependencies to build one from -- so the
 * value is discovered here and the download is routed through a tool that does
 * honour it. Without this, the download fails on any machine behind a proxy, which
 * on Windows is a setting most people never set by hand: a VPN or proxy client
 * writes it into the registry and every browser follows it silently.
 */
function detectProxy() {
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  if (process.platform !== 'win32') return ''
  try {
    // Read the same WinINET setting the browsers and curl use. A disabled proxy
    // or an empty value means direct.
    const script = [
      "$k = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue",
      'if ($k -and $k.ProxyEnable -eq 1 -and $k.ProxyServer) { $k.ProxyServer }',
    ].join('; ')
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!out) return ''
    // A ProxyServer setting can list per-scheme entries ("http=a;https=b").
    const https = /(?:^|;)\s*https=([^;]+)/i.exec(out)
    const value = (https ? https[1] : out.split(';')[0]).trim()
    if (!value) return ''
    return /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`
  } catch {
    return ''
  }
}

/**
 * Download `url` to `dest` through an HTTP proxy, by opening a CONNECT tunnel.
 *
 * Node's `fetch` cannot use a proxy without a dispatcher, and this package has no
 * dependencies to build one from. A tunnel is the small piece of the protocol that
 * matters here: ask the proxy to connect to the origin, then speak TLS to the
 * origin over that socket. It also streams, so a few hundred megabytes do not sit
 * in memory, and progress can be reported while it runs.
 */
function downloadThroughProxy(url, dest, proxy) {
  return new Promise((resolvePromise, rejectPromise) => {
    const target = new URL(url)
    const proxyUrl = new URL(proxy.includes('://') ? proxy : `http://${proxy}`)
    const proxyPort = Number(proxyUrl.port || 80)

    const fail = (error) => { try { socket?.destroy() } catch { /* already gone */ } ; rejectPromise(error) }
    let socket = netConnect(proxyPort, proxyUrl.hostname)

    socket.setTimeout(60000, () => fail(new Error('proxy connection timed out')))
    socket.once('error', (error) => fail(new Error(`proxy ${proxyUrl.hostname}:${proxyPort}: ${error.message}`)))

    socket.once('connect', () => {
      // Basic auth, if the proxy URL carries credentials.
      const auth = proxyUrl.username
        ? `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')}\r\n`
        : ''
      socket.write(`CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\n${auth}\r\n`)

      let head = Buffer.alloc(0)
      const onHead = (chunk) => {
        head = Buffer.concat([head, chunk])
        const end = head.indexOf('\r\n\r\n')
        if (end < 0) return
        socket.off('data', onHead)
        const status = /^HTTP\/1\.[01] (\d{3})/.exec(head.toString('latin1'))
        if (!status || status[1] !== '200') {
          fail(new Error(`proxy refused CONNECT: ${status ? status[1] : 'no status'}`))
          return
        }
        // Anything after the header belongs to the tunnel.
        const rest = head.subarray(end + 4)
        if (rest.length > 0) socket.unshift(rest)
        request()
      }
      socket.on('data', onHead)

      const request = () => {
        const tlsSocket = tlsConnect({ socket, servername: target.hostname }, () => {
          tlsSocket.write(
            `GET ${target.pathname}${target.search} HTTP/1.1\r\n` +
            `Host: ${target.hostname}\r\n` +
            'User-Agent: dsh-say-voice-fetch\r\n' +
            'Accept: */*\r\n' +
            'Connection: close\r\n\r\n',
          )
        })
        tlsSocket.once('error', (error) => fail(new Error(`tls: ${error.message}`)))

        let headersDone = false
        let buffer = Buffer.alloc(0)
        let received = 0
        let expected = 0
        let out = null
        let redirects = 0

        tlsSocket.on('data', (chunk) => {
          if (!headersDone) {
            buffer = Buffer.concat([buffer, chunk])
            const end = buffer.indexOf('\r\n\r\n')
            if (end < 0) return
            const head = buffer.toString('latin1', 0, end)
            const status = /^HTTP\/1\.[01] (\d{3})/.exec(head)
            const code = status ? Number(status[1]) : 0
            if (code >= 300 && code < 400) {
              const location = /^location:\s*(.+)$/im.exec(head)
              tlsSocket.destroy()
              if (location && redirects < 5) {
                // Follow the redirect from scratch: the release URL redirects to a
                // CDN host, which needs its own tunnel.
                redirects += 1
                downloadThroughProxy(new URL(location[1], target).toString(), dest, proxy)
                  .then(resolvePromise, rejectPromise)
                return
              }
              fail(new Error(`unfollowable redirect (${code})`))
              return
            }
            if (code !== 200) { fail(new Error(`HTTP ${code}`)); return }
            const length = /^content-length:\s*(\d+)/im.exec(head)
            expected = length ? Number(length[1]) : 0
            headersDone = true
            out = createWriteStream(dest)
            out.once('error', (error) => fail(new Error(`writing ${dest}: ${error.message}`)))
            const rest = buffer.subarray(end + 4)
            if (rest.length > 0) { received += rest.length; out.write(rest) }
            return
          }
          received += chunk.length
          out.write(chunk)
          if (expected > 0) {
            const percent = Math.floor((received / expected) * 100)
            if (percent >= progressShown + 10) { progressShown = percent; process.stdout.write(`\r  ${percent}%`) }
          }
        })

        tlsSocket.on('end', () => {
          if (!out) { fail(new Error('connection closed before any data arrived')); return }
          out.end(() => {
            if (expected > 0) process.stdout.write('\r')
            resolvePromise()
          })
        })
      }
    })
  })
}

/** Download to `dest`, direct where possible and through the proxy where not. */
async function download(url, dest) {
  const proxy = detectProxy()
  let directError = ''

  if (!proxy) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      writeFileSync(dest, Buffer.from(await response.arrayBuffer()))
      return
    } catch (error) {
      directError = error?.cause?.message || error?.message || String(error)
    }
  }

  try {
    if (proxy) console.log(`using proxy ${proxy}`)
    else console.log('direct download failed, retrying through the system proxy')
    await downloadThroughProxy(url, dest, proxy || detectProxyFromRegistry())
  } catch (error) {
    rmSync(dest, { force: true })
    console.error(`\ndownload failed${directError ? ` (direct: ${directError})` : ''}: ${error?.message || error}`)
    console.error('if you are behind a proxy, set HTTPS_PROXY and retry; or download the archive yourself and pass --from')
    process.exit(1)
  }
}

/** The registry proxy, used when a direct attempt failed and no env var is set. */
function detectProxyFromRegistry() {
  if (process.platform !== 'win32') {
    throw new Error('no proxy configured, and the direct download failed')
  }
  const found = detectProxy()
  if (!found) throw new Error('no proxy configured, and the direct download failed')
  return found
}

let progressShown = -10

const args = process.argv.slice(2)
const fromIndex = args.indexOf('--from')
const fromPath = fromIndex >= 0 ? args[fromIndex + 1] : ''
const printOnly = args.includes('--print-commands')
// `--out <dir>` unpacks somewhere other than voice/, and `--url <url>` fetches a
// different archive. Both exist because the download is also useful on its own -
// staging the bundle for a machine that has no checkout, or verifying what a
// release actually serves without unpacking 1.4 GB into the repository.
const outIndex = args.indexOf('--out')
const outDir = outIndex >= 0 ? resolve(args[outIndex + 1]) : ''
const urlIndex = args.indexOf('--url')
const urlOverride = urlIndex >= 0 ? args[urlIndex + 1] : ''
// The release carries two archives and SOURCE.json describes both: the PyTorch one
// at the top level and the much smaller ONNX one under `onnx`. `--onnx` splices that
// block over the top level, so every existing reader of source.url, source.sha256 and
// source.archive keeps working without knowing there are two.
const wantOnnx = args.includes('--onnx')

const parsedSource = existsSync(sourcePath)
  ? JSON.parse(readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''))
  : {}

const source = wantOnnx ? { ...parsedSource, ...(parsedSource.onnx || {}) } : parsedSource

if (wantOnnx && !parsedSource.onnx?.url) {
  console.error('scripts/SOURCE.json has no "onnx" archive described, so --onnx has nothing to fetch.')
  process.exit(1)
}

/**
 * A path relative to the repository, for display.
 *
 * `.replace(`${repoRoot}\\`, '')` silently does nothing when the runtime reports
 * separators differently, which is how a full absolute path ended up printed
 * mid-sentence — and how that path's non-ASCII directory arrived mangled on a
 * console whose code page is not UTF-8.
 */
function shownPath(path) {
  if (!path) return ''
  const relative = path.startsWith(repoRoot) ? path.slice(repoRoot.length) : path
  return relative.replace(/^[\\/]+/, '').split('\\').join('/')
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function install(archive, label) {
  const into = outDir || voiceDir
  console.log(`extracting ${label} into ${shownPath(into)}`)
  // The paths go through the environment rather than the command string. Node's
  // own filesystem layer could unzip this, but the archive is extracted with the
  // platform's tool so a user's existing unzip behaviour (long paths, odd
  // entries) is the same as anywhere else. Passing the paths as values instead of
  // embedding them keeps a non-ASCII repository path out of the argument a shell
  // has to re-parse -- this repository's own path contains 工作流记录.
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Expand-Archive -LiteralPath $env:DSH_FETCH_ARCHIVE -DestinationPath $env:DSH_FETCH_INTO -Force',
  ], {
    stdio: 'inherit',
    env: { ...process.env, DSH_FETCH_ARCHIVE: archive, DSH_FETCH_INTO: into },
  })

  const files = walk(into)
  // The bundle carries the base models alongside the voice, so "the first .ckpt"
  // picks `s1v3.ckpt` and "the first .pth" picks `s2Gv2ProPlus.pth` - both base
  // models. The guidance printed below would then tell the user to register a base
  // model as their voice: an install that succeeds and speaks in the wrong voice.
  // The same exclusion runs in install-voice, which is what actually registers.
  const BUNDLED_BASE = new Set([
    's1v3.ckpt', 's2Gv2ProPlus.pth', 'config.json',
    'preprocessor_config.json', 'tokenizer.json', 'pytorch_model.bin',
  ])
  const voiceFiles = files.filter((file) => !BUNDLED_BASE.has(basename(file)))
  const gpt = voiceFiles.find((file) => file.endsWith('.ckpt'))
  const sovits = voiceFiles.find((file) => file.endsWith('.pth'))
  const references = files.filter((file) => file.endsWith('.wav'))

  // The summary below describes the PyTorch pack: weights to copy into a checkout, a
  // reference clip to register. The ONNX pack has none of those - no .ckpt, no .pth,
  // a model directory instead - so printing it there produces a wall of "NOT FOUND"
  // and three instructions that do not apply. Its caller (install-onnx.mjs) knows
  // what to do with the files, so it just gets the archive.
  if (wantOnnx) {
    console.log(`\nunpacked into ${shownPath(intoDir)}: ${files.length} file(s)`)
    process.exit(0)
  }

  console.log('\ninstalled:')
  console.log(`  checkpoint : ${gpt ? shownPath(gpt) : 'NOT FOUND'}`)
  console.log(`  weights    : ${sovits ? shownPath(sovits) : 'NOT FOUND'}`)
  console.log(`  references : ${references.length}`)
  if (references.length > 0) {
    console.log(`               e.g. ${references[0].split(/[\\/]/).pop()}`)
  }

  const gptRel = gpt ? shownPath(gpt) : '<GPT_weights…/*.ckpt>'
  const sovitsRel = sovits ? shownPath(sovits) : '<SoVITS_weights…/*.pth>'
  const refRel = references.length > 0 ? shownPath(references[0]) : '<reference_audios/…wav>'

  console.log('\nnext steps:')
  console.log('  1. copy the weights into your GPT-SoVITS checkout:')
  console.log(`       copy ${gptRel}   ->  <engineRoot>/GPT_weights_v2ProPlus/`)
  console.log(`       copy ${sovitsRel} ->  <engineRoot>/SoVITS_weights_v2ProPlus/`)
  console.log('  2. ask your agent to register the pack:')
  console.log(`       tts_voices action=add name=<voice> refAudio=<abs path to ${refRel}> \\`)
  console.log(`         promptText="<the reference clip's exact transcript>" \\`)
  console.log(`         gpt=GPT_weights_v2ProPlus/${gpt ? gpt.split(/[\\/]/).pop() : '<file>.ckpt'} \\`)
  console.log(`         sovits=SoVITS_weights_v2ProPlus/${sovits ? sovits.split(/[\\/]/).pop() : '<file>.pth'}`)
  console.log('\n  The reference filenames from this pack carry their own transcripts.')
}

if (printOnly) {
  // Reports the resolved source rather than a canned line, so `--onnx` is visible
  // in the answer. A hint that always names the same command is a hint that quietly
  // stops being true the moment a second archive exists.
  console.log(`archive : ${source.archive || '(unnamed)'}`)
  console.log(`url     : ${source.url || '(none — SOURCE.json has no url)'}`)
  console.log(`sha256  : ${source.sha256 || '(not recorded)'}`)
  console.log('')
  console.log('fetch it with:')
  console.log(`  node scripts/fetch-voice.mjs${wantOnnx ? ' --onnx' : ''}`)
  console.log('or unpack a file you already have:')
  console.log('  node scripts/fetch-voice.mjs --from <archive.zip>')
  process.exit(0)
}

if (fromPath) {
  const archive = resolve(fromPath)
  if (!existsSync(archive)) {
    console.error(`no such archive: ${archive}`)
    process.exit(1)
  }
  install(archive, archive)
  process.exit(0)
}

const url = urlOverride || source.url
if (!url) {
  console.error('scripts/SOURCE.json has no "url" set.')
  console.error('Either fill it in, or pass a local archive:')
  console.error('  node scripts/fetch-voice.mjs --from <archive.zip>')
  process.exit(1)
}

const intoDir = outDir || voiceDir
mkdirSync(intoDir, { recursive: true })
const archive = join(intoDir, source.archive || 'voice-weights.zip')

console.log(`downloading ${url}`)
await download(url, archive)
const bytes = readFileSync(archive)
console.log(`saved ${(bytes.length / 1024 / 1024).toFixed(1)} MB to ${shownPath(archive)}`)

if (source.sha256) {
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest.toLowerCase() !== String(source.sha256).toLowerCase()) {
    // Keep the rejected file rather than deleting it: when a maintainer has just
    // replaced the release asset, having the actual bytes on disk is what makes
    // the mismatch diagnosable instead of a message with no evidence.
    console.error(`checksum mismatch:\n  expected ${source.sha256}\n  actual   ${digest}`)
    console.error(`refusing to extract an archive that does not match SOURCE.json (left at ${archive})`)
    process.exit(1)
  }
  console.log('checksum ok')
}

install(archive, 'the downloaded archive')
