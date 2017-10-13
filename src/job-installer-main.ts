import {installJob} from './job-installer-api';

export default async function main(argv, showHelp) {
  if (!argv.n || !argv.c) {
    console.error("You must specify both name and command");
    showHelp();
    
    process.exit(-1);
  }
  
  let extraEnvs = argv.environment ? argv.environment.split(',') : null;
  let result = await installJob(argv.name, argv.command, argv['dry-run'], argv.type, extraEnvs);
  
  if (!argv['dry-run']) {
    console.log(result);
    return;
  }
  
  if (Object.keys(result) < 2) {
    for (let file in result) { console.log(result[file]); }
  } else {
    for (let file in result) {
      console.log(`${file}:\n`);
      console.log(result[file]);
    }
  }
}
