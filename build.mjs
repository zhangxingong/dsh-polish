// 构建驱动：rm lib 后用当前 node 直接执行 tsdown 入口（无 shell、跨平台）。
import { rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
process.chdir(HERE)

await rm('lib', { recursive: true, force: true })
const require = createRequire(import.meta.url)
const pkgJson = require.resolve('tsdown/package.json')
const tsdownEntry = join(dirname(pkgJson), 'dist', 'run.mjs')
execFileSync(process.execPath, [tsdownEntry], { stdio: 'inherit' })
