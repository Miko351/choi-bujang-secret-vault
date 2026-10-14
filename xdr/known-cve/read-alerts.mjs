import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FIXTURE = new URL('../fixtures/known-cve.json', import.meta.url);
const REDACTED = '[가림]';
// Inspection only: redact the whole selected value instead of echoing a secret fragment.
const SENSITIVE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sb_(?:secret|publishable)_|sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+|\bAKIA[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:password|passwd|pwd|passphrase|(?:access|refresh)[_-]?token|token|api[_-]?key|client[_-]?secret|secret|authorization|비밀번호|토큰|비밀\s*키)["']?\s*[:=]|https?:\/\/[^\s/]+:[^\s/]+@|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b[A-F0-9]{32,}\b|[A-Za-z0-9_+/=-]{40,}/iu;

function safeText(value) {
  if (typeof value !== 'string') return null;
  if (SENSITIVE.test(value)) return REDACTED;
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu, ' ');
}

export function extractAlerts(fixture) {
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'known-cve'
      || !Array.isArray(fixture.alerts)) throw new Error('ALERT_FIXTURE_INVALID');
  return Array.from(fixture.alerts, alert => {
    const timestamp = alert?.timestamp;
    const srcip = alert?.data?.srcip;
    const level = alert?.rule?.level;
    // Select fields explicitly. Do not serialize the original alert, data or rule.
    return {
      timestamp: typeof timestamp === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(timestamp)
        && Number.isFinite(Date.parse(timestamp)) ? timestamp : null,
      srcip: typeof srcip === 'string' && isIP(srcip) !== 0 ? srcip : null,
      srcuser: safeText(alert?.data?.srcuser),
      level: Number.isSafeInteger(level) && level >= 0 ? level : null,
      description: safeText(alert?.rule?.description),
    };
  });
}

export async function readAlerts(fixtureUrl = DEFAULT_FIXTURE) {
  try {
    return extractAlerts(JSON.parse(await readFile(fixtureUrl, 'utf8')));
  } catch {
    // JSON parser and filesystem errors can contain raw input. Never forward them.
    throw new Error('ALERT_INPUT_INVALID');
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const rows = await readAlerts();
    for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
    process.stderr.write(`경보 ${rows.length}건 · 출력 ${rows.length}줄\n`);
  } catch {
    process.stderr.write('경보 읽기 실패: 입력 파일이나 형식을 확인하세요.\n');
    process.exitCode = 1;
  }
}