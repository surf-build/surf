import createDebug from 'debug'
import type BuildDiscoverBase from './build-discover-base'
import AutotoolsBuildDiscoverer from './build-discoverers/autotools'
import BuildScriptDiscoverer from './build-discoverers/build-script'
import CmakeBuildDiscoverer from './build-discoverers/cmake'
import DangerBuildDiscoverer from './build-discoverers/danger'
import DotNetBuildDiscoverer from './build-discoverers/dotnet'
import MonoRepoBuildDiscoverer from './build-discoverers/monorepo'
import NpmBuildDiscoverer from './build-discoverers/npm'
import RustBuildDiscoverer from './build-discoverers/rust'
import XcodeBuildDiscoverer from './build-discoverers/xcode'

const d = createDebug('surf:build-api')

const DISCOVERER_CLASSES = [
  AutotoolsBuildDiscoverer,
  BuildScriptDiscoverer,
  CmakeBuildDiscoverer,
  DangerBuildDiscoverer,
  DotNetBuildDiscoverer,
  MonoRepoBuildDiscoverer,
  NpmBuildDiscoverer,
  RustBuildDiscoverer,
  XcodeBuildDiscoverer,
] as (new (
  rootPath: string
) => BuildDiscoverBase)[]

export function createBuildDiscovers(rootPath: string): BuildDiscoverBase[] {
  return DISCOVERER_CLASSES.map((Klass) => {
    d(`Found build discoverer: ${Klass.name}`)
    return new Klass(rootPath)
  })
}
