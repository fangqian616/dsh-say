/**
 * Replace the weights archive on the GitHub release, from the command line.
 *
 *   GITHUB_TOKEN=ghp_xxx node scripts/upload-release.mjs
 *   node scripts/upload-release.mjs --token ghp_xxx --dry-run
 *
 * Why a script rather than the web UI: the asset is 1.3 GB, the checksum has to
 * match scripts/SOURCE.json, and the failure mode of a half-done upload is a
 * download that fails its checksum check for everyone. This deletes the old asset
 * and uploads the new one in one step, then verifies what the release actually
 * serves against SOURCE.json.
 *
 * Maintainer tool. Not part of the published package, and it carries no token of
 * its own - pass one per invocation.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const args = process.argv.slice(2)
const tokenFlag = args.indexOf('--token')
const token = (tokenFlag >= 0 ? args[tokenFlag + 1] : '') || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const dryRun = args.includes('--dry-run')
const repoFlag = args.indexOf('--repo')
const repo = repoFlag >= 0 ? args[repoFlag + 1] : 'fangqian616/dsh-say'
const fileFlag = args.indexOf('--file')
const archive = fileFlag >= 0
  ? args[fileFlag + 1]
  : join(process.env.TEMP || '/tmp', 'dsh-voice-release', 'sample-full-v2ProPlus.zip')

const source = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'scripts', 'SOURCE.json'), 'utf8'))

if (!token) {
  console.error('no GitHub token. Create one with the "repo" scope and pass it:')
  console.error('  $env:GITHUB_TOKEN = "ghp_<paste the real token here>"')
  console.error('  node scripts/upload-release.mjs')
  console.error('  (or --token <token>)')
  console.error('\nCreate one at https://github.com/settings/tokens — it looks like a long')
  console.error('random string beginning with ghp_ or github_pat_.')
  process.exit(1)
}

// A token is ASCII and unbroken. Without this check, a placeholder pasted as-is
// (`ghp_你的token`) reaches the HTTP layer, which rejects non-Latin1 header bytes
// with "Cannot convert argument to a ByteString ... a value of 20320" - a message
// that says nothing about the actual mistake. The prefix check comes first so the
// common "I copied it including the word Bearer" case gets its own explanation.
if (/^(Bearer|token)\s/i.test(token)) {
  console.error('pass the token itself, without the "Bearer " prefix — the script adds it.')
  process.exit(1)
}
if (!/^[\x21-\x7e]+$/.test(token)) {
  const bad = [...token].find((char) => char.charCodeAt(0) > 255 || /\s/.test(char))
  console.error('that does not look like a GitHub token.')
  console.error(`  it contains ${JSON.stringify(bad)} (code ${bad.charCodeAt(0)}); tokens are ASCII with no spaces.`)
  console.error('  an unreplaced placeholder is the usual cause — paste the real token.')
  console.error('  create one at https://github.com/settings/tokens (scope: repo)')
  process.exit(1)
}

if (!existsSync(archive)) {
  console.error(`no such file: ${archive}`)
  process.exit(1)
}

const api = `https://api.github.com/repos/${repo}`
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'dsh-say-upload',
  'X-GitHub-Api-Version': '2022-11-28',
}

const sha256 = (path) => new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject)
})

const size = statSync(archive).size
const digest = await sha256(archive)
const name = basename(archive)

// The local file has to be the one SOURCE.json describes, or uploading it publishes
// an archive that every download will reject.
console.log(`file      : ${name}`)
console.log(`size      : ${(size / 1048576).toFixed(1)} MB`)
console.log(`sha256    : ${digest}`)
console.log(`SOURCE.json: ${source.sha256}`)
if (digest !== source.sha256 || size !== source.bytes) {
  console.error('\nthis file does not match scripts/SOURCE.json. Refusing to upload: the')
  console.error('release would serve bytes that every fetch refuses on checksum.')
  process.exit(1)
}
console.log('matches SOURCE.json\n')

if (dryRun) {
  console.log('[dry run] would delete any asset named ' + name + ' and upload this file')
  process.exit(0)
}

const releases = await (await fetch(`${api}/releases`, { headers })).json()
if (!Array.isArray(releases) || releases.length === 0) {
  console.error('no releases found')
  process.exit(1)
}
const release = releases[0]
console.log(`release   : ${release.tag_name}`)

// One archive per release, and it must be the current one.
//
// Deleting only the same-named asset is not enough: this release once carried
// `silver-wolf-full-v2ProPlus.zip`, and superseding it with a differently-named
// archive would leave the old one downloadable — which, after the voice was
// de-identified, means the character-named file stays on the internet even though
// nothing in the repository mentions it any more. So every archive-shaped asset
// that is not the one being uploaded goes.
const ARCHIVE_LIKE = /^(?:silver-wolf|sample)[\w.-]*\.zip$/i
const stale = release.assets.filter((asset) => asset.name !== name && ARCHIVE_LIKE.test(asset.name))
for (const asset of release.assets.filter((a) => a.name === name || ARCHIVE_LIKE.test(a.name))) {
  console.log(`deleting  : ${asset.name} (asset ${asset.id}, ${(asset.size / 1048576).toFixed(1)} MB)`)
  const response = await fetch(`${api}/releases/assets/${asset.id}`, { method: 'DELETE', headers })
  if (!response.ok && response.status !== 404) {
    console.error(`could not delete asset ${asset.id}: HTTP ${response.status}`)
    process.exit(1)
  }
}

console.log('uploading...')
const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`
const uploaded = await fetch(uploadUrl, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
  body: createReadStream(archive),
  duplex: 'half',
})

if (!uploaded.ok) {
  console.error(`upload failed: HTTP ${uploaded.status}`)
  console.error(await uploaded.text())
  process.exit(1)
}
const asset = await uploaded.json()
console.log(`uploaded  : id=${asset.id} size=${asset.size}`)

// What matters is what a download gets, not what the API reports, so the published
// bytes are fetched back and hashed.
//
// The download goes through fetch-voice rather than a plain fetch here: node's fetch
// cannot reach github.com behind a proxy on this machine, so the verification step
// would hang instead of verifying - which is exactly what happened the first time
// this ran. fetch-voice already streams through the proxy and checks the hash
// against SOURCE.json, so the check is the same code a user runs.
console.log('\nverifying what the release now serves...')
const verifyDir = join(process.env.TEMP || '/tmp', 'dsh-say-upload-verify')
rmSync(verifyDir, { recursive: true, force: true })
let verifyError = null
try {
  execFileSync(process.execPath, [
    join(import.meta.dirname, 'fetch-voice.mjs'),
    '--url', `https://github.com/${repo}/releases/latest/download/${name}`,
    '--out', verifyDir,
  ], { stdio: ['ignore', 'inherit', 'pipe'] })
} catch (error) {
  verifyError = error?.stderr ? String(error.stderr).trim().split('\n').slice(-2).join(' ') : String(error?.message || error)
}

if (verifyError !== null) {
  // Two very different failures look identical from here, and saying the wrong one
  // is worse than saying neither: a network or proxy problem means the release was
  // never read, while a checksum failure means it was read and is wrong. The upload
  // is confirmed by the API in both cases, so the message must not imply otherwise.
  const unreachable = /proxy|ECONNRESET|ENOTFOUND|ETIMEDOUT|Connect Timeout|Unable to connect|download failed/i.test(verifyError)
  console.error(unreachable
    ? `\ncould not verify: the archive could not be downloaded (${verifyError})`
    : `\nverification failed: the published archive does not match SOURCE.json (${verifyError})`)
  console.error('the upload itself succeeded — the API reports ' + (size / 1048576).toFixed(1) + ' MB, matching this file.')
  console.error('re-run the check when the network allows:')
  console.error(`  node scripts/fetch-voice.mjs --url https://github.com/${repo}/releases/latest/download/${name} --out <dir>`)
  process.exit(unreachable ? 2 : 1)
}
rmSync(verifyDir, { recursive: true, force: true })
console.log('\nok: the release serves the archive SOURCE.json describes')
