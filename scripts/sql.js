// 화면 검증용 SQL 도구 (학생 추가 파일, 제공 코드 아님)
// 서버가 켜진 상태에서 다른 터미널로 실행합니다. 사용: node scripts/sql.js "SQL문"
// SELECT는 표로 출력하고, 그 외(UPDATE·DELETE·CREATE/DROP TRIGGER)는 실행만 합니다.
import { DatabaseSync } from 'node:sqlite';
import { defaultDbPath } from '../src/db.js';
const sql = process.argv[2];
if (!sql) { console.log('사용: node scripts/sql.js "SELECT * FROM applications"'); process.exit(1); }
const db = new DatabaseSync(process.env.DB_PATH || defaultDbPath);
db.exec('PRAGMA busy_timeout=5000');
if (/^\s*select/i.test(sql)) console.table(db.prepare(sql).all());
else { db.exec(sql); console.log('실행 완료:', sql); }
db.close();
