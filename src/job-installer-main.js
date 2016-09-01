import {installJob} from './job-installer-api';

export default async function main(argv, showHelp) {
  if (!argv.n || !argv.c) {
    console.error("You must specify both name and command");
    showHelp();
    
    process.exit(-1);
  }
  
  let result = await installJob(argv.name, argv.command, argv['dry-run'], argv.type);
  console.log(result);
}
