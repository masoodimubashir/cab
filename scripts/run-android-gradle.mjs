import { spawnSync } from 'node:child_process';
import path from 'node:path';

const task = process.argv[2];
if (!['bundleRelease', 'assembleRelease'].includes(task)) {
  throw new Error('Expected bundleRelease or assembleRelease');
}
const windows = process.platform === 'win32';
const result = spawnSync(
  windows ? 'cmd.exe' : './gradlew',
  windows ? ['/d', '/s', '/c', `gradlew.bat ${task}`] : [task],
  { cwd: path.resolve('android'), stdio: 'inherit' },
);
if (result.error) {
  console.error(result.error.message);
}
process.exit(result.status ?? 1);
