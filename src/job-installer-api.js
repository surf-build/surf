import fs from 'fs';
import path from 'path';

const d = require('debug')('surf:job-installer-api');

export function createJobInstallers() {
  let discoverClasses = fs.readdirSync(path.join(__dirname, 'job-installers'));

  return discoverClasses.filter((x) => x.match(/\.js$/i)).map((x) => {
    const Klass = require(path.join(__dirname, 'job-installers', x)).default;

    d(`Found job installer: ${Klass.name}`);
    return new Klass();
  });
}

export function installJob(name, command, returnContent=false, explicitType=null, extraEnvVars=null) {
  let installer = null;
  
  if (explicitType) {
    installer = createJobInstallers().find((x) => x.getName() == explicitType);
    
    if (!installer) {
      let names = createJobInstallers().map((x) => x.getName());
      
      throw new Error(`Couldn't find job installer with name ${explicitType} - available types are ${names.join(', ')}`);
    }
  } else {
    installer = createJobInstallers().reduce((acc, installer) => {
      let affinity = installer.getAffinityForJob(name, command);

      if (affinity < 1) return acc;
      if (!acc) return { affinity, installer };

      return acc.affinity >= affinity ? acc : { affinity, installer };
    }, null).installer;
    
    if (!installer) {
      let names = createJobInstallers().map((x) => x.getName());
      
      throw new Error(`Can't find a compatible job installer for your platform - available types are - ${names.join(', ')}`);
    }
  }

  if (extraEnvVars) installer.setExtraEnvVars(extraEnvVars);
  return installer.installJob(name, command, returnContent);
}
