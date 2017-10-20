const interestingEnvVars = [
  /^GITHUB_TOKEN$/,
  /^GIST_TOKEN$/,
  /^GITHUB_ENTERPRISE_URL$/,
  /^GIST_ENTERPRISE_URL$/,
  /^SURF_/,
  /^PATH$/
];

export default class JobInstallerBase {
  extraEnvVars: string[];

  constructor() {
  }

  getInterestingEnvVars() {
    return Object.keys(process.env)
      .filter((x) => interestingEnvVars.find((re) => !!x.match(re)))
      .concat(this.extraEnvVars || []);
  }
  
  setExtraEnvVars(vars: string[]) {
    this.extraEnvVars = vars;
  }
  
  getName(): string {
    throw new Error("Implement me!");
  }

  async getAffinityForJob(_name: string, _command: string): Promise<number> {
    throw new Error("Implement me!");
  }

  async installJob(_name: string, _command: string, _returnContent?: boolean): Promise<string | Object> {
    throw new Error("Implement me!");
  }
}
