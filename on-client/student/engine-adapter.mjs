// 기존 프로젝트에서 검증된 서버·에이전트 기능을 이 어댑터에 연결합니다.
// 본인 범위의 조회에는 검증된 로그인·기기 정보만 사용합니다. XDR 전체 사건 조회는 운영자 범위입니다.
// 실행자가 개인 SDP 호스트를 명시한 경우에만 본인 범위의 연결 기능을 받습니다.
// 토큰·인증서·개인키는 호스트가 보관하며 이 모듈로 전달하지 않습니다.
export function createEngine(host) {
  if (!host || typeof host.projectId !== 'string'
      || ['readIdentity','readApps','decideAccess'].some(name => typeof host[name] !== 'function')) {
    throw new Error('ENGINE_ADAPTER_INVALID');
  }
  return Object.freeze({
    evidenceMode: 'connected',
    projectId: host.projectId,
    readIdentity: options => host.readIdentity(options),
    readApps: (scope, options) => host.readApps(scope, options),
    decideAccess: (input, scope, options) => host.decideAccess(input, scope, options),
    // 실제 호스트가 제공한 본인 조회만 전달한다. 미지원 조회를 빈 성공으로 만들지 않는다.
    ...(typeof host.readEvents === 'function' ? {readEvents: (scope, options) => host.readEvents(scope, options)} : {}),
    ...(typeof host.readDevices === 'function' ? {readDevices: (scope, options) => host.readDevices(scope, options)} : {}),
    ...(typeof host.readSessions === 'function' ? {readSessions: (scope, options) => host.readSessions(scope, options)} : {}),
  });
}

export default {
  evidenceMode: 'disconnected',
};
