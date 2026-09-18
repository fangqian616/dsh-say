/**
 * fetch-voice.mjs checks that need no network. Run: node test/fetch.mjs
 *
 * The download itself cannot run in CI, so what is checked here are the two
 * mistakes that have actually happened in this file and that no runtime test
 * would catch without a live release:
 *
 * 1. The destination path being passed on a command line. `powershell -Command`
 *    reads its argument in the console code page, so a repository under a
 *    non-ASCII path (this one is `E:\ai工作流记录\…`) arrives mangled and the write
 *    fails on a directory that does not exist. The path has to travel in the
 *    environment, which is Unicode.
 * 2. A proxy being ignored. Node's `fetch` does not read HTTPS_PROXY without a
 *    dispatcher, and on Windows most users never set the variable at all: a proxy
 *    client writes the setting into the registry where every browser follows it.
 *    A fetch that only tries `fetch()` cannot download for those users.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'scripts', 'fetch-voice.mjs'), 'utf8')

let failures = 0
const check = (label, condition, detail = '') => {
  if (!condition) failures += 1
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('fetch-voice checks')

console.log('\n1. no path or url is passed on a command line')
const commands = [...source.matchAll(/execFileSync\([^)]*\[([^\]]*)\]/gs)].map((m) => m[1])
check('the file spawns a shell somewhere', commands.length > 0)
check('no spawned argument interpolates a filesystem path',
  !commands.some((args) => /\$\{(?:dest|archive|voiceDir|repoRoot)/.test(args)),
  'a path in argv is read in the console code page and mangles non-ASCII directories')
// The download itself writes through a stream in this process, so no child
// process is handed the destination at all. Asserting that is stronger than
// asserting the path went into an environment variable, and it is the property
// that keeps the non-ASCII-path failure from coming back.
check('the download never shells out to write a file',
  !commands.some((args) => /-(?:OutFile|o)\b|Invoke-WebRequest|curl|wget/i.test(args)))
check('it streams to the destination directly', /createWriteStream\(dest\)/.test(source))

console.log('\n2. a proxy is discovered and actually used')
check('it reads the proxy environment variables', /HTTPS_PROXY/.test(source))
check('it can read the Windows registry proxy setting', /Internet Settings/.test(source))
check('it opens a CONNECT tunnel', /CONNECT \$\{target\.hostname\}/.test(source))
check('the tunnel is TLS, not plain', /tlsConnect\(/.test(source))
check('a redirect is followed (the release URL points at a CDN host)',
  /300 && code < 400|code >= 300/.test(source))

console.log('\n3. the integrity guard is intact')
check('a checksum mismatch refuses to extract', /refusing to extract/.test(source))
check('the mismatch keeps the file for diagnosis', /left at/.test(source))
check('the expected hash comes from SOURCE.json', /source\.sha256/.test(source))

console.log('\n4. a path is displayed relative, not as an absolute string')
check('there is one helper for display paths', /function shownPath/.test(source))
check('no raw repoRoot string-strip is left for display',
  !/replace\(`\$\{repoRoot\}\\`/.test(source),
  'the strip silently does nothing when separators differ')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
