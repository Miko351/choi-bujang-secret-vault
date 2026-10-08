import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'data.json');
const output = resolve(root, 'public', 'data.json');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (![1, 2].includes(config.step)) {
  throw new Error('이 단계의 공개 빌드 흐름을 먼저 구현해 주세요.');
}
const data = JSON.parse(await readFile(source, 'utf8'));
if (!Array.isArray(data.notes)) {
  throw new Error('실습용 공개 자료 형식을 확인하세요. 실제 학생 자료를 넣으면 안 됩니다.');
}
await mkdir(resolve(root, 'public'), { recursive: true });
if (config.step === 1) {
  await copyFile(source, output);
  console.log('실습용 공개 자료를 public/data.json에 복사했습니다.');
} else {
  // Never copy source notes into static output after moving them to the database.
  await writeFile(output, `${JSON.stringify({ sampleMarker: config.sampleMarker, notes: [] }, null, 2)}\n`, 'utf8');
  if (data.notes.length !== 0) {
    throw new Error('2단계 data.json에는 메모를 남길 수 없습니다. SQL 이관 파일은 local-only/에 보관하세요.');
  }
  console.log('메모가 없는 public/data.json을 생성했습니다.');
}
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
}
