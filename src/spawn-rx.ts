import type { SpawnOptions } from 'node:child_process'
import { spawn as childProcessSpawn } from 'node:child_process'
import type { Observable } from 'rxjs'
import {
  findActualExecutable,
  spawn as spawnBase,
  spawnPromise as spawnPromiseBase,
} from '../node_modules/spawn-rx/src/index'

type SpawnExtras = SpawnOptions & {
  echoOutput?: boolean
  retries?: number
  retryDelay?: number
  stdin?: Observable<string>
  timeout?: number
}

export { findActualExecutable }

export function spawn(exe: string, params: string[], opts?: SpawnExtras) {
  return spawnBase(exe, params, { ...(opts ?? {}), split: false })
}

export function spawnDetached(exe: string, params: string[], opts?: SpawnExtras) {
  return spawn(exe, params, opts)
}

export function spawnPromise(exe: string, params: string[], opts?: SpawnExtras) {
  return spawnPromiseBase(exe, params, { ...(opts ?? {}), split: false })
}

export function spawnDetachedPromise(exe: string, params: string[], opts?: SpawnExtras) {
  const { cmd, args } = findActualExecutable(exe, params)
  const processHandle = childProcessSpawn(cmd, args, {
    ...(opts ?? {}),
    detached: true,
    stdio: 'ignore',
  })

  processHandle.unref()
  return Promise.resolve('')
}
