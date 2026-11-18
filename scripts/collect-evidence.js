// 보고서용 증거 수집 스크립트 (학생 추가 파일, 제공 코드 아님)
// 임시 DB에서 서버를 띄워 실제 HTTP 요청을 보내고, 요청 전후의 applications·application_history를 출력합니다.
// 토큰 값은 출력하지 않습니다. 실행: node scripts/collect-evidence.js > docs/evidence/scenario-evidence.txt
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

const dir = mkdtempSync(join(tmpdir(), 'assignment2-evidence-'));
const db = openDb(join(dir, 'evidence.sqlite'));
const server = createApp({ db, secret: randomBytes(48).toString('hex') }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function request(path, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
const tokens = {};
for (const u of ['alice', 'bob', 'charlie', 'manager1', 'manager2'])
  tokens[u] = (await request('/api/auth/login', { method: 'POST', body: { username: u, password: 'Classroom123!' } })).data.accessToken;

const apps = () => db.prepare('SELECT id,event_id,user_id,status,created_at FROM applications ORDER BY id').all();
const hist = () => db.prepare('SELECT id,application_id,actor_id,action,from_status,to_status,reason,cause_history_id FROM application_history ORDER BY id').all();
const approved = e => db.prepare("SELECT COUNT(*) AS n FROM applications WHERE event_id=? AND status='APPROVED'").get(e).n;
const reset = () => db.exec('DELETE FROM application_history; DELETE FROM applications; DELETE FROM sqlite_sequence');
const show = (label, v) => console.log(`${label}\n${JSON.stringify(v, null, 1)}`);
const call = async (who, method, path, body) => {
  const r = await request(path, { token: tokens[who], method, body });
  console.log(`> ${who}  ${method} ${path}${body ? ' ' + JSON.stringify(body) : ''}`);
  console.log(`< ${r.status} ${JSON.stringify(r.data)}`);
  return r;
};
const section = t => console.log(`\n==================== ${t} ====================`);

// 1. 거부 사례: 다른 학생의 대기 취소 (R1, T07)
section('E1 거부 사례: bob이 alice의 대기 신청을 취소');
reset();
const a1 = (await call('alice', 'POST', '/api/events/1/applications', {})).data;
show('[요청 전] applications', apps()); show('[요청 전] history', hist());
await call('bob', 'POST', `/api/applications/${a1.id}/cancel`, {});
show('[요청 후] applications', apps()); show('[요청 후] history', hist());

// 2. 오래된 화면 승인 거부 + 정원 초과 (R4, R8, T10, T13)
section('E2 최신 상태: 학생이 취소한 뒤 운영자가 오래된 화면에서 승인');
reset();
const a2 = (await call('alice', 'POST', '/api/events/1/applications', {})).data;
await call('alice', 'POST', `/api/applications/${a2.id}/cancel`, {});
await call('manager1', 'POST', `/api/applications/${a2.id}/approve`, {});
show('[결과] applications', apps()); console.log(`행사1 승인 인원 = ${approved(1)}`);

section('E3 정원: 행사1(정원 2)에서 세 번째 승인');
reset();
const ids = [];
for (const u of ['alice', 'bob', 'charlie']) ids.push((await call(u, 'POST', '/api/events/1/applications', {})).data.id);
await call('manager1', 'POST', `/api/applications/${ids[0]}/approve`, {});
await call('manager1', 'POST', `/api/applications/${ids[1]}/approve`, {});
console.log(`[요청 전] 행사1 승인 인원 = ${approved(1)}`);
await call('manager1', 'POST', `/api/applications/${ids[2]}/approve`, {});
console.log(`[요청 후] 행사1 승인 인원 = ${approved(1)}`); show('[요청 후] applications', apps());

// 3. 대기 순서 (R5, T18, T19)
const nextSql = "SELECT id FROM applications WHERE event_id = ? AND status = 'PENDING' ORDER BY created_at ASC, id ASC LIMIT 1";
section('E4 대기 순서(시각 다름): bob 11-02, charlie 11-01 → charlie 승급');
reset();
let a = (await call('alice', 'POST', '/api/events/2/applications', {})).data;
await call('manager2', 'POST', `/api/applications/${a.id}/approve`, {});
let b = (await call('bob', 'POST', '/api/events/2/applications', {})).data;
let c = (await call('charlie', 'POST', '/api/events/2/applications', {})).data;
db.prepare('UPDATE applications SET created_at=? WHERE id=?').run('2026-11-02T00:00:00.000Z', b.id);
db.prepare('UPDATE applications SET created_at=? WHERE id=?').run('2026-11-01T00:00:00.000Z', c.id);
show('[요청 전] applications', apps());
console.log(`선택 SQL: ${nextSql}  → ${JSON.stringify(db.prepare(nextSql).get(2))}`);
await call('manager2', 'POST', `/api/applications/${a.id}/revoke`, { reason: '운영 사정으로 승인 취소' });
show('[요청 후] applications', apps());

section('E5 대기 순서(시각 같음): 같은 created_at → 작은 id(bob) 승급');
reset();
a = (await call('alice', 'POST', '/api/events/2/applications', {})).data;
await call('manager2', 'POST', `/api/applications/${a.id}/approve`, {});
b = (await call('bob', 'POST', '/api/events/2/applications', {})).data;
c = (await call('charlie', 'POST', '/api/events/2/applications', {})).data;
db.prepare("UPDATE applications SET created_at='2026-11-01T00:00:00.000Z' WHERE status='PENDING'").run();
show('[요청 전] applications', apps());
console.log(`선택 SQL 결과 → ${JSON.stringify(db.prepare(nextSql).get(2))}`);
await call('manager2', 'POST', `/api/applications/${a.id}/revoke`, { reason: '운영 사정으로 승인 취소' });
show('[요청 후] applications', apps()); show('[요청 후] history', hist());

// 4. 롤백 (R7, T29): AUTO_APPROVE 이력 저장을 트리거로 실패시킴
section('E6 롤백: AUTO_APPROVE 이력 INSERT 실패 주입 후 승인 취소');
reset();
a = (await call('alice', 'POST', '/api/events/1/applications', {})).data;
await call('manager1', 'POST', `/api/applications/${a.id}/approve`, {});
b = (await call('bob', 'POST', '/api/events/1/applications', {})).data;
const before = { applications: apps(), history: hist() };
show('[요청 전]', before);
db.exec("CREATE TRIGGER fail_auto BEFORE INSERT ON application_history WHEN NEW.action='AUTO_APPROVE' BEGIN SELECT RAISE(ABORT,'TEST_INJECTED_FAILURE'); END");
console.log('트리거 설치: fail_auto (AUTO_APPROVE INSERT 시 ABORT)');
await call('manager1', 'POST', `/api/applications/${a.id}/revoke`, { reason: '운영 사정으로 승인 취소' });
const after = { applications: apps(), history: hist() };
show('[요청 후]', after);
console.log(`요청 전과 동일? ${JSON.stringify(before) === JSON.stringify(after)}`);
db.exec('DROP TRIGGER fail_auto');
console.log('트리거 제거 후 재시도');
await call('manager1', 'POST', `/api/applications/${a.id}/revoke`, { reason: '운영 사정으로 승인 취소' });
show('[재시도 후] applications', apps()); show('[재시도 후] history', hist());

await new Promise(r => server.close(r));
db.close();
rmSync(dir, { recursive: true, force: true });
