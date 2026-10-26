import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import iconv from "iconv-lite";
import * as https from "node:https";
import { once } from "node:events";
import AdmZip from "adm-zip";
import { Agent, buildConnector, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./index.js";
import { parseDomestic, parseOverseas, search, getDbStats, ALL_MARKETS, refresh, ensureFresh } from "./master.js";

// ─── 임시 DB 셋업 ─────────────────────────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kis_mcp_test_"));
const testDbPath = path.join(tmpDir, "test.db");
// openDb() 가 호출될 때 이 경로를 읽음
process.env["KIS_MCP_DB_PATH"] = testDbPath;

type Row = [string, string, string, string | null];

function seedDb(records: Row[], updatedMarkets: Record<string, string> = {}) {
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const db = new DatabaseSync(testDbPath);
  db.exec(`
    CREATE TABLE stocks (code TEXT NOT NULL, name TEXT NOT NULL, market TEXT NOT NULL, exchange TEXT);
    CREATE INDEX idx_stocks_code   ON stocks(code);
    CREATE INDEX idx_stocks_name   ON stocks(name);
    CREATE INDEX idx_stocks_market ON stocks(market);
    CREATE TABLE meta (market TEXT PRIMARY KEY, updated_date TEXT NOT NULL);
  `);
  const ins = db.prepare("INSERT INTO stocks VALUES (?, ?, ?, ?)");
  for (const r of records) ins.run(...r);
  for (const [mkt, dt] of Object.entries(updatedMarkets)) {
    db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run(mkt, dt);
  }
  db.close();
}

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

// ─── parseDomestic ────────────────────────────────────────────────────────────

describe("parseDomestic", () => {
  // 레이아웃: [0:9] 종목코드, [9:21] 표준코드, [21:len-offset] 종목명, suffix(offset bytes)
  test("KOSPI 단일 종목 파싱 (offset=228)", () => {
    const line = "005930   " + "KR7005930003" + "삼성전자" + "X".repeat(228);
    const raw = iconv.encode(line, "cp949");
    const records = parseDomestic(raw, "KOSPI", 228);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], ["005930", "삼성전자", "KOSPI", null]);
  });

  test("KOSDAQ 단일 종목 파싱 (offset=222)", () => {
    const line = "035720   " + "KR7035720002" + "카카오" + "Y".repeat(222);
    const raw = iconv.encode(line, "cp949");
    const records = parseDomestic(raw, "KOSDAQ", 222);
    assert.equal(records.length, 1);
    assert.equal(records[0][0], "035720");
    assert.equal(records[0][1], "카카오");
    assert.equal(records[0][2], "KOSDAQ");
  });

  test("종목명 내 공백 제거", () => {
    const line = "000660   " + "KR7000660001" + "SK 하이닉스" + "Z".repeat(228);
    const raw = iconv.encode(line, "cp949");
    const [rec] = parseDomestic(raw, "KOSPI", 228);
    assert.equal(rec[1], "SK하이닉스");
  });

  test("너무 짧은 라인은 건너뜀", () => {
    const line = "005930   " + "KR7005930003" + "짧음"; // 21 + 4 = 25, <= 21+228
    const raw = iconv.encode(line, "cp949");
    const records = parseDomestic(raw, "KOSPI", 228);
    assert.equal(records.length, 0);
  });

  test("빈 코드/이름 라인은 건너뜀", () => {
    // 코드가 공백뿐인 경우
    const line = "         " + "KR7005930003" + "삼성전자" + "X".repeat(228);
    const raw = iconv.encode(line, "cp949");
    const records = parseDomestic(raw, "KOSPI", 228);
    assert.equal(records.length, 0);
  });

  test("복수 라인 파싱", () => {
    const make = (code: string, name: string) =>
      code.padEnd(9) + "KR0000000000" + name + "X".repeat(228);
    const raw = iconv.encode(
      [make("000001", "종목A"), make("000002", "종목B")].join("\n"),
      "cp949",
    );
    const records = parseDomestic(raw, "KOSPI", 228);
    assert.equal(records.length, 2);
    assert.equal(records[0][0], "000001");
    assert.equal(records[1][0], "000002");
  });
});

// ─── parseOverseas ────────────────────────────────────────────────────────────

describe("parseOverseas", () => {
  // TSV: col[4]=심볼, col[6]=한국명
  function makeLine(cols: string[]) {
    return cols.join("\t");
  }

  // 해외 마스터 파일도 CP949 인코딩 (KIS 파일 전체 공통)
  test("기본 TSV 파싱", () => {
    const line = makeLine(["a", "b", "c", "d", "AAPL", "f", "애플"]);
    const raw = iconv.encode(line, "cp949");
    const records = parseOverseas(raw, "NAS");
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], ["AAPL", "애플", "NAS", "NAS"]);
  });

  test("종목명 내 공백 제거", () => {
    const line = makeLine(["a", "b", "c", "d", "TSLA", "f", "테슬라 모터스"]);
    const raw = iconv.encode(line, "cp949");
    const [rec] = parseOverseas(raw, "NAS");
    assert.equal(rec[1], "테슬라모터스");
  });

  test("컬럼 수 부족한 라인은 건너뜀", () => {
    const line = "a\tb\tc\td\tAAPL\tf"; // 6 cols, need >= 7
    const raw = iconv.encode(line, "cp949");
    const records = parseOverseas(raw, "NAS");
    assert.equal(records.length, 0);
  });

  test("exchange 코드가 market 과 exchange 양쪽에 저장됨", () => {
    const line = makeLine(["a", "b", "c", "d", "GOOGL", "f", "구글"]);
    const raw = iconv.encode(line, "cp949");
    const [rec] = parseOverseas(raw, "NYS");
    assert.equal(rec[2], "NYS"); // market
    assert.equal(rec[3], "NYS"); // exchange
  });
});

// ─── search ───────────────────────────────────────────────────────────────────

describe("search", () => {
  before(() => {
    seedDb(
      [
        ["005930", "삼성전자", "KOSPI", null],
        ["035720", "카카오", "KOSDAQ", null],
        ["000660", "SK하이닉스", "KOSPI", null],
        ["AAPL", "애플", "NAS", "NAS"],
        ["TSLA", "테슬라모터스", "NAS", "NAS"],
        ["005380", "현대자동차", "KOSPI", null],
      ],
      { KOSPI: new Date().toISOString().slice(0, 10) },
    );
  });

  test("종목코드 정확 일치", () => {
    const r = search("005930");
    assert.equal(r.length, 1);
    assert.equal(r[0].name, "삼성전자");
  });

  test("종목명 정확 일치", () => {
    const r = search("카카오");
    assert.equal(r[0].code, "035720");
  });

  test("종목명 앞글자(prefix) 매치", () => {
    const r = search("삼성");
    assert.ok(r.some((x) => x.code === "005930"));
  });

  test("종목명 포함(contains) 매치", () => {
    const r = search("하이닉");
    assert.ok(r.some((x) => x.code === "000660"));
  });

  test("존재하지 않는 종목 → 빈 배열", () => {
    const r = search("없는종목XYZXYZ");
    assert.equal(r.length, 0);
  });

  test("markets 필터 — NAS 만 조회", () => {
    const r = search("애플", ["NAS"]);
    assert.equal(r.length, 1);
    assert.equal(r[0].code, "AAPL");
  });

  test("markets 필터 — KOSPI 에서 AAPL 은 나오지 않음", () => {
    const r = search("AAPL", ["KOSPI"]);
    assert.equal(r.length, 0);
  });

  test("limit 가 결과 수를 제한함", () => {
    // "자" 포함 종목이 여러 개일 수 있지만 limit=1
    const r = search("현대", null, 1);
    assert.equal(r.length, 1);
  });

  test("markets=null 이면 전체 시장 검색", () => {
    const r = search("테슬라모터스", null);
    assert.ok(r.some((x) => x.market === "NAS"));
  });
});

// ─── getDbStats ───────────────────────────────────────────────────────────────

describe("getDbStats", () => {
  before(() => {
    const today = new Date().toISOString().slice(0, 10);
    seedDb(
      [
        ["005930", "삼성전자", "KOSPI", null],
        ["035720", "카카오", "KOSDAQ", null],
        ["AAPL", "애플", "NAS", "NAS"],
      ],
      { KOSPI: today, KOSDAQ: today, NAS: today },
    );
  });

  test("ALL_MARKETS 키를 모두 포함", () => {
    const stats = getDbStats();
    for (const m of ALL_MARKETS) {
      assert.ok(m in stats, `${m} 키 없음`);
    }
  });

  test("시장별 종목 수 정확", () => {
    const stats = getDbStats();
    assert.equal(stats["KOSPI"].count, 1);
    assert.equal(stats["KOSDAQ"].count, 1);
    assert.equal(stats["NAS"].count, 1);
  });

  test("갱신일 문자열 형식 YYYY-MM-DD", () => {
    const stats = getDbStats();
    assert.match(stats["KOSPI"].updated, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("데이터 없는 시장은 count=0, updated='없음'", () => {
    const stats = getDbStats();
    assert.equal(stats["TSE"].count, 0);
    assert.equal(stats["TSE"].updated, "없음");
  });
});

describe("마스터 TLS 검증과 기존 캐시 보존", () => {
  // 로컬 테스트 서버 전용 인증서/키입니다. 운영 신뢰 저장소와 무관합니다.
  const cert = fs.readFileSync(new URL("./fixtures/localhost-cert.pem", import.meta.url));
  const key = fs.readFileSync(new URL("./fixtures/localhost-key.pem", import.meta.url));
  const previousDispatcher = getGlobalDispatcher();
  const incoming: string[] = [];
  let agent: Agent | undefined;
  let port: number;
  function zip(raw: Buffer): Buffer {
    const archive = new AdmZip();
    archive.addFile("master.mst", raw);
    return archive.toBuffer();
  }
  const domesticZip = zip(iconv.encode("005930   " + "KR7005930003" + "삼성전자" + "X".repeat(228), "cp949"));
  const overseasZip = zip(iconv.encode("a\tb\tc\td\tAAPL\tf\t애플", "cp949"));
  const tlsServer = https.createServer({ cert, key }, (req, res) => {
    incoming.push(req.url!);
    res.end(req.url!.includes("kospi") ? domesticZip : overseasZip);
  });

  before(async () => {
    tlsServer.listen(0, "127.0.0.1");
    await once(tlsServer, "listening");
    port = (tlsServer.address() as { port: number }).port;
  });
  afterEach(async () => {
    setGlobalDispatcher(previousDispatcher);
    await agent?.close();
    agent = undefined;
  });
  after(async () => {
    tlsServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => tlsServer.close((error) => error ? reject(error) : resolve()));
  });
  function routeToLocal(trustCert = false, servername = "localhost") {
    const connect = buildConnector(trustCert ? { ca: cert } : {});
    agent = new Agent({ connect: (options, callback) => connect({ ...options, hostname: "127.0.0.1", port: String(port), servername }, callback) });
    setGlobalDispatcher(agent);
  }

  test("미신뢰 인증서와 호스트 불일치를 거절하며 캐시와 갱신일을 보존한다", async () => {
    seedDb([["OLD", "기존종목", "KOSPI", null]], { KOSPI: "2020-01-01" });
    const count = incoming.length;
    routeToLocal();
    await assert.rejects(refresh("KOSPI"), (error: { cause?: { code?: string } }) => error.cause?.code === "DEPTH_ZERO_SELF_SIGNED_CERT");
    const statuses = await ensureFresh(["KOSPI"]);
    assert.match(statuses.KOSPI, /^실패/);
    assert.match(statuses.KOSPI, /갱신일 2020-01-01/);
    assert.equal(search("OLD")[0].name, "기존종목");
    assert.equal(getDbStats().KOSPI.updated, "2020-01-01");
    await agent!.close();
    routeToLocal(true, "wrong.example");
    await assert.rejects(refresh("KOSPI"), (error: { cause?: { code?: string } }) => error.cause?.code === "ERR_TLS_CERT_ALTNAME_INVALID");
    assert.equal(incoming.length, count, "TLS 검증 실패 시 HTTP 자료를 받지 않아야 함");
    assert.equal(search("OLD").length, 1);
  });

  test("신뢰한 인증서로 국내·해외 마스터 다운로드와 정상 갱신이 유지된다", async () => {
    seedDb([]);
    routeToLocal(true);
    assert.equal(await refresh("KOSPI"), 1);
    assert.equal(await refresh("NAS"), 1);
    assert.equal(search("삼성전자")[0].code, "005930");
    assert.equal(search("애플")[0].code, "AAPL");
    const stats = getDbStats();
    assert.equal(stats.KOSPI.updated, new Date().toISOString().slice(0, 10));
    const count = incoming.length;
    assert.equal((await ensureFresh(["KOSPI"])).KOSPI, "최신");
    assert.equal(incoming.length, count, "최신 캐시는 재다운로드하지 않음");
  });

  test("MCP 검색은 실패한 갱신일과 기존 결과를 함께 제공하며 빈 캐시도 명시한다", async () => {
    seedDb([["005930", "삼성전자", "KOSPI", null]], { KOSPI: "2020-01-01" });
    routeToLocal();
    const server = createServer("market");
    const client = new Client({ name: "cache-tests", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      const response = await client.callTool({ name: "kis_search_stock", arguments: { query: "삼성전자", markets: ["KOSPI", "NAS"] } });
      const data = JSON.parse((response.content as { text: string }[])[0].text);
      assert.equal(data.결과[0].code, "005930");
      assert.match(data.마스터_갱신상태.KOSPI, /갱신일 2020-01-01/);
      assert.match(data.마스터_갱신상태.NAS, /기존 캐시: 없음/);
      assert.ok(data.경고.includes("KOSPI"));
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("캐시 상태를 읽을 수 없어도 시장별 실패 상태를 반환한다", async () => {
    seedDb([]);
    routeToLocal();
    process.env.KIS_MCP_DB_PATH = path.join(testDbPath, "unusable.db");
    try {
      const statuses = await ensureFresh(["KOSPI", "NAS"]);
      assert.match(statuses.KOSPI, /^실패:.*기존 캐시: 확인 불가$/);
      assert.match(statuses.NAS, /^실패:.*기존 캐시: 확인 불가$/);
    } finally {
      process.env.KIS_MCP_DB_PATH = testDbPath;
    }
  });
});
