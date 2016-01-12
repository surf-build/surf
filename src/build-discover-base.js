export default class BuildDiscoverBase {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async getAffinityForRootDir() {
    throw new Error("Implement me!");
  }

  async getBuildCommand(sha) {
    throw new Error("Implement me!");
  }
}
