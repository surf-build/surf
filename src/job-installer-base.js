export default class JobInstallerBase {
  constructor() {
  }

  async getAffinityForJob(name, command) {
    throw new Error("Implement me!");
  }

  async installJob(name, command) {
    throw new Error("Implement me!");
  }
}
