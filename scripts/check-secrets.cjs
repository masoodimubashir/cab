// Scan Git's index (what will be committed), never print credential values.
const { execFileSync, spawnSync } = require('node:child_process');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const patterns = [
  ['Google API key', 'AIza[0-9A-Za-z_-]{35}'],
  ['private key', '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'],
];
let failed = false;
for (const [label, pattern] of patterns) {
  const result = spawnSync('git', ['grep', '--cached', '-a', '-l', '-z', '-E', '-e', pattern],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error('Unable to scan the Git index.');
  }
  for (const file of result.stdout.split('\0').filter(Boolean)) {
    console.error(`${label} detected in ${file} (value hidden)`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log(`PASS: ${files.length} indexed files checked for Google API keys and private keys.`);
