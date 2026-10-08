import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'data.json');
const output = resolve(root, 'public', 'data.json');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (!Number.isInteger(config.step) || config.step < 1 || config.step > 12) {
  throw new Error('aleph.config.json의 step은 1~12 정수여야 합니다.');
}
await mkdir(resolve(root, 'public'), { recursive: true });
if (config.step === 1) {
  const data = JSON.parse(await readFile(source, 'utf8'));
  if (!Array.isArray(data.notes)) throw new Error('실습용 공개 자료 형식이 맞지 않습니다.');
  await copyFile(source, output);
  console.log('실습용 공개 자료를 public/data.json에 복사했습니다.');
} else {
  // Remove stale output from earlier builds; never create a static notes file again.
  await rm(output, { force: true });
  let data;
  try {
    data = JSON.parse(await readFile(source, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (data && (!Array.isArray(data.notes) || data.notes.length !== 0)) {
    throw new Error('2단계 이후 data.json에는 메모를 남길 수 없습니다. SQL 이관 파일은 local-only/에 보관하세요.');
  }
  console.log('2단계 이후에는 public/data.json을 생성하지 않습니다.');
}
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
}
