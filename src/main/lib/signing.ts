import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function detectMacSigning(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  const { stdout } = await execFileAsync('security', ['find-identity', '-v', '-p', 'codesigning']);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /"[^"]+"/.test(line) && !line.includes('0 valid identities'));
}
