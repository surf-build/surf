export interface BuildCommand {
  cmd: string;
  args: string[];
}

export interface BuildCommandResult {
  cmds: BuildCommand[];
  artifactDirs?: string[];
}

export default class BuildDiscoverBase {
  public shouldAlwaysRun: boolean;
  public rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  getAffinityForRootDir(): Promise<number>  {
    throw new Error("Implement me!");
  }

  getBuildCommand(_sha: string): Promise<BuildCommandResult>  {
    throw new Error("Implement me!");
  }
}
