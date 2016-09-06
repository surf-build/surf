const interestingEnvVars = [
  /^GITHUB_TOKEN$/,
  /^GIST_TOKEN$/,
  /^GITHUB_ENTERPRISE_URL$/,
  /^GIST_ENTERPRISE_URL$/,
  /^SURF_/,
  /^PATH$/
];

export default class JobInstallerBase {
  constructor() {
  }

  getInterestingEnvVars() {
    return Object.keys(process.env)
      .filter((x) => interestingEnvVars.find((re) => x.match(re)));
  }
  
  getName() {
    throw new Error("Implement me!");
  }

  async getAffinityForJob(name, command) {
    throw new Error("Implement me!");
  }

  async installJob(name, command, returnContent=false) {
    throw new Error("Implement me!");
  }
}
