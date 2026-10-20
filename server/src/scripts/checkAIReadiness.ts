import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { validateReadiness, type ReadinessResult } from '../safety/readiness.js';

// Explicit metadata JSON input only. Never read env files, credentials, or account APIs.
function checkFile(args: string[]): ReadinessResult {
  const failed = (code: string): ReadinessResult => ({ ready: false, errors: [code] });
  if (args.length !== 1) return failed('EVIDENCE_ARGUMENT_INVALID');
  const path = resolve(args[0]);
  if (extname(path).toLowerCase() !== '.json' || /^\.env(?:\.|$)/i.test(basename(path))) {
    return failed('EVIDENCE_FILE_INVALID');
  }
  let fd: number | undefined;
  try {
    if (!lstatSync(path).isFile() || realpathSync(path) !== path) return failed('EVIDENCE_FILE_INVALID');
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > 16_384) return failed('EVIDENCE_FILE_INVALID');
    const buffer = Buffer.alloc(16_385);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > 16_384) return failed('EVIDENCE_FILE_INVALID');
    let record: unknown;
    try { record = JSON.parse(buffer.subarray(0, size).toString('utf8')); }
    catch { return failed('EVIDENCE_JSON_INVALID'); }
    return validateReadiness(record, Date.now());
  } catch { return failed('EVIDENCE_FILE_INVALID'); }
  finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* Read-only descriptor. */ } } }
}

const result = checkFile(process.argv.slice(2));
console.log(JSON.stringify(result));
process.exitCode = result.ready ? 0 : 1;
