import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { createApiClient, createServer } from "./index.js";
import { MARKET_TOOLS, marketEnvelope } from "./market.js";

const origin = "https://openapi.koreainvestment.com:9443";
const prefix = "/uapi/domestic-stock/v1/quotations/";
const indexPath = prefix + "inquire-index-price";
const indexParams = { FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: "0001" };
const investorParams = {
  FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: "0001", FID_INPUT_DATE_1: "20261023",
  FID_INPUT_DATE_2: "20261023", FID_INPUT_ISCD_1: "KSP", FID_INPUT_ISCD_2: "0001",
};
const investorRow = {
  stck_bsop_date: "20261023", frgn_ntby_qty: "0", prsn_ntby_qty: "-10", orgn_ntby_qty: "10",
  frgn_ntby_tr_pbmn: "0", prsn_ntby_tr_pbmn: "-100", orgn_ntby_tr_pbmn: "100",
};
const mockAgent = new MockAgent();
const previousDispatcher = getGlobalDispatcher();
const previousEnv = { ...process.env };
const requests: { method: string; path: string; body?: unknown }[] = [];
let payload: Record<string, unknown> = {};
let statusCode = 200;
let responseHeaders: Record<string, string> = {};
let tokenPayload: Record<string, unknown> = { access_token: "test-token", access_token_token_expired: "2099-01-01 00:00:00" };
const client = new Client({ name: "market-tests", version: "1" });
const server = createServer("market");

before(async () => {
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  // 가짜 인증정보만 사용합니다. 실계좌 환경변수는 필요하지 않습니다.
  process.env.KIS_APP_KEY = "test-app-key";
  process.env.KIS_APP_SECRET = "test-app-secret";
  delete process.env.KIS_ACCOUNT_NO;
  const pool = mockAgent.get(origin);
  pool.intercept({ path: "/oauth2/tokenP", method: "POST" }).reply((opts) => {
    requests.push({ method: opts.method, path: opts.path, body: opts.body });
    return { statusCode: 200, data: tokenPayload };
  }).persist();
  pool.intercept({ path: () => true, method: "GET" }).reply((opts) => {
    requests.push({ method: opts.method, path: opts.path });
    return { statusCode, data: JSON.stringify(payload), responseOptions: { headers: responseHeaders } };
  }).persist();
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
});

after(async () => {
  await client.close();
  await server.close();
  setGlobalDispatcher(previousDispatcher);
  await mockAgent.close();
  process.env = previousEnv;
});

async function call(name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  const content = response.content as { type: string; text: string }[];
  return { response, envelope: JSON.parse(content[0].text) };
}

test("시장 MCP는 정확히 10개 도구만 노출하고 계좌·주문 도구를 거절한다", async () => {
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, [...MARKET_TOOLS].sort());
  const count = requests.length;
  for (const name of ["kis_get_domestic_balance", "kis_get_account_assets", "kis_get_overseas_balance", "kis_place_domestic_order", "kis_place_overseas_order", "kis_revise_or_cancel_domestic_order"]) {
    const response = await client.callTool({ name, arguments: {} });
    assert.equal(response.isError, true, name);
  }
  assert.equal(requests.length, count);
});

test("허용하지 않은 요청은 인증정보 확인과 네트워크 전에 차단된다", async () => {
  const api = createApiClient("market");
  const savedKey = process.env.KIS_APP_KEY;
  delete process.env.KIS_APP_KEY;
  const count = requests.length;
  const forbidden: [string, string, string, Record<string, string>, string?][] = [
    ["real", "/uapi/domestic-stock/v1/trading/inquire-balance", "TTTC8434R", {}],
    ["real", "/uapi/overseas-stock/v1/trading/inquire-balance", "TTTS3012R", {}],
    ["real", "https://example.com/", "FHPUP02100000", indexParams],
    ["real", indexPath + "?extra=1", "FHPUP02100000", indexParams],
    ["real", prefix + "../trading/order-cash", "FHPUP02100000", indexParams],
    ["real", prefix + "%69nquire-index-price", "FHPUP02100000", indexParams],
    ["real", "__proto__", "FHPUP02100000", indexParams],
    ["real", indexPath, "TTTC0012U", indexParams],
    ["real", indexPath, "FHPUP02100000", { ...indexParams, CANO: "12345678" }],
    ["real", indexPath, "FHPUP02100000", { ...indexParams, FID_INPUT_ISCD: "0002" }],
    ["demo", indexPath, "FHPUP02100000", indexParams],
    ["typo", indexPath, "FHPUP02100000", indexParams],
    ["real", indexPath, "FHPUP02100000", indexParams, "N"],
    ["real", prefix + "inquire-investor-daily-by-market", "FHPTJ04040000", { ...investorParams, FID_INPUT_DATE_1: "20260230" }],
    ["real", prefix + "inquire-investor-daily-by-market", "FHPTJ04040000", { ...investorParams, FID_INPUT_ISCD_1: "KSQ" }],
  ];
  try {
    for (const args of forbidden) {
      await assert.rejects(api.apiGet(...args), (error: Error) => !error.message.includes("환경변수를 설정"));
    }
    for (const path of [prefix + "inquire-index-price", "/oauth2/tokenP", "/uapi/domestic-stock/v1/trading/order-cash"]) {
      await assert.rejects(api.apiPost("real", path, "TTTC0012U", {}), /POST/);
    }
    assert.equal(requests.length, count);
  } finally {
    process.env.KIS_APP_KEY = savedKey;
  }
});

test("토큰 없는 인증 응답이면 시장 HTTP 조회를 실행하지 않는다", async () => {
  const saved = tokenPayload;
  const count = requests.length;
  tokenPayload = { error_code: "AUTH_ERROR" };
  try {
    const { response, envelope } = await call("kis_get_index_price", {});
    assert.equal(response.isError, true);
    assert.equal(envelope.metadata.status, "error");
    assert.equal(envelope.metadata.fetched_at, null);
    assert.equal(requests.length, count + 1);
    assert.equal(requests.at(-1)!.method, "POST");
  } finally {
    tokenPayload = saved;
  }
});

test("신규 API 4종은 공식 인수로 조회하고 원문·출처·응답 날짜·시장 범위를 보존한다", async () => {
  const cases = [
    { name: "kis_get_index_price", args: { index_code: "2001" }, path: "inquire-index-price", trId: "FHPUP02100000", raw: { rt_cd: "0", output: { bstp_nmix_prpr: "400.00", ascn_issu_cnt: "100", down_issu_cnt: "80", stnr_issu_cnt: "20" } } },
    { name: "kis_get_market_investor_daily", args: { market: "KOSDAQ", date: "20261023" }, path: "inquire-investor-daily-by-market", trId: "FHPTJ04040000", raw: { rt_cd: "0", output: [investorRow] } },
    { name: "kis_get_stock_investor_daily", args: { stock_code: "005930", date: "20261023", market: "NX" }, path: "investor-trade-by-stock-daily", trId: "FHPTJ04160001", raw: { rt_cd: "0", output1: { stck_prpr: "70000" }, output2: [investorRow] } },
    { name: "kis_get_program_trade_daily", args: { market: "KOSPI", venue: "UN", start_date: "20261023", end_date: "20261023" }, path: "comp-program-trade-daily", trId: "FHPPG04600001", raw: { rt_cd: "0", output: [{ stck_bsop_date: "20261023", arbt_smtn_ntby_tr_pbmn: "-12.34", nabt_smtn_ntby_tr_pbmn: "56.78" }] } },
  ];
  for (const fixture of cases) {
    payload = fixture.raw;
    const started = Date.now();
    const { envelope, response } = await call(fixture.name, fixture.args);
    assert.equal(response.isError, false);
    assert.equal(envelope.metadata.status, "ok", fixture.name);
    assert.equal(envelope.metadata.source.path, prefix + fixture.path);
    assert.equal(envelope.metadata.source.tr_id, fixture.trId);
    assert.equal(envelope.metadata.data_as_of, null);
    assert.ok(Date.parse(envelope.metadata.fetched_at) >= started);
    assert.deepEqual(envelope.raw, fixture.raw);
    assert.equal(envelope.metadata.units.conversion_applied, false);
    assert.equal(envelope.metadata.units.monetary, null);
    if (fixture.name !== "kis_get_index_price") assert.deepEqual(envelope.metadata.response_dates, ["20261023"]);
    const url = new URL(requests.at(-1)!.path, origin);
    assert.equal(url.pathname, prefix + fixture.path);
    if (fixture.name === "kis_get_market_investor_daily") {
      assert.equal(url.searchParams.get("FID_INPUT_ISCD"), "1001");
      assert.equal(url.searchParams.get("FID_INPUT_ISCD_1"), "KSQ");
      assert.equal(url.searchParams.get("FID_INPUT_DATE_2"), "20261023");
      assert.equal(envelope.metadata.market_scope.venue, "unspecified_by_api");
    }
    if (fixture.name === "kis_get_stock_investor_daily") {
      assert.equal(url.searchParams.get("FID_ORG_ADJ_PRC"), "");
      assert.equal(envelope.metadata.market_scope.venue, "NXT");
    }
    if (fixture.name === "kis_get_program_trade_daily") assert.equal(envelope.metadata.market_scope.venue, "INTEGRATED");
  }
  const posts = requests.filter((r) => r.method === "POST");
  assert.equal(posts.length, 2, "인증 실패 1회 뒤 정상 발급한 토큰은 재사용");
  assert.equal(posts[0].path, "/oauth2/tokenP");
  assert.deepEqual(JSON.parse(String(posts[0].body)), { grant_type: "client_credentials", appkey: "test-app-key", appsecret: "test-app-secret" });
});

test("재사용 시세 도구 4개도 시장 모드에서는 원응답과 메타데이터를 제공한다", async () => {
  const cases = [
    { name: "kis_get_domestic_stock_price", args: { stock_code: "005930", market: "J" }, raw: { rt_cd: "0", output: { stck_prpr: "70000" } } },
    { name: "kis_get_domestic_stock_chart", args: { stock_code: "005930" }, raw: { rt_cd: "0", output1: { stck_prpr: "70000" }, output2: [{ stck_bsop_date: "20261023", stck_clpr: "70000" }] } },
    { name: "kis_get_overseas_stock_price", args: { symbol: "AAPL", exchange: "NAS" }, raw: { rt_cd: "0", output: { last: "250.00" } } },
    { name: "kis_get_overseas_stock_chart", args: { symbol: "AAPL", exchange: "NAS" }, raw: { rt_cd: "0", output1: { rsym: "NASAAPL" }, output2: [{ xymd: "20261023", clos: "250.00" }] } },
  ];
  for (const fixture of cases) {
    payload = fixture.raw;
    const { envelope } = await call(fixture.name, fixture.args);
    assert.deepEqual(envelope.raw, fixture.raw);
    assert.equal(envelope.metadata.status, "ok");
  }
});

test("오류·빈 응답·부분 응답·요청일 누락을 구분하고 0을 결측으로 취급하지 않는다", async () => {
  const path = prefix + "inquire-investor-daily-by-market";
  const envelope = (raw: Record<string, unknown>, trCont = "") => marketEnvelope("real", path, "FHPTJ04040000", investorParams, raw, trCont);
  assert.equal(envelope({ rt_cd: "0", output: [investorRow] }).metadata.status, "ok");
  assert.equal(envelope({ rt_cd: "0", output: [] }).metadata.status, "empty");
  assert.equal(envelope({ rt_cd: "0" }).metadata.status, "partial");
  assert.equal(envelope({ rt_cd: "0", output: ["malformed"] }).metadata.status, "partial");
  assert.equal(envelope({ rt_cd: "0", output: [] }, "M").metadata.status, "partial");
  assert.equal(envelope({ rt_cd: "0", output: [{ stck_bsop_date: "", frgn_ntby_qty: "" }] }).metadata.status, "empty");
  assert.equal(envelope({ rt_cd: "1", msg_cd: "E001", msg1: "조회 실패", output: [] }).metadata.status, "error");
  assert.equal(envelope({ rt_cd: "0", output: [{ ...investorRow, frgn_ntby_qty: "" }] }).metadata.status, "partial");
  assert.equal(envelope({ rt_cd: "0", output: [investorRow] }, "M").metadata.status, "partial");
  assert.equal(envelope({ rt_cd: "0", output: [investorRow] }, "F").metadata.continuation.more_available, true);
  const previousDay = envelope({ rt_cd: "0", output: [{ ...investorRow, stck_bsop_date: "20261022" }] });
  assert.equal(previousDay.metadata.status, "partial");
  assert.equal(previousDay.metadata.requested_date_present, false);
  assert.deepEqual(previousDay.metadata.response_dates, ["20261022"]);
  assert.equal(previousDay.metadata.requested_dates.FID_INPUT_DATE_1, "20261023");

  payload = { rt_cd: "1", msg_cd: "E001", msg1: "조회 실패" };
  assert.equal((await call("kis_get_index_price", {})).response.isError, true);
  statusCode = 503;
  const failed = await call("kis_get_index_price", {});
  assert.equal(failed.response.isError, true);
  assert.equal(failed.envelope.metadata.http_status, 503);
  assert.deepEqual(failed.envelope.raw, payload);
  statusCode = 200;
});

test("잘못된 날짜·시장·역전된 기간은 네트워크 전에 거절한다", async () => {
  const count = requests.length;
  for (const [name, args] of [
    ["kis_get_market_investor_daily", { date: "20260230" }],
    ["kis_get_stock_investor_daily", { stock_code: "005930", date: "20261023", market: "typo" }],
    ["kis_get_program_trade_daily", { start_date: "20261024", end_date: "20261023" }],
    ["kis_get_domestic_stock_price", { stock_code: "005930", env: "demo" }],
    ["kis_get_index_price", { env: "demo" }],
  ] as const) assert.equal((await client.callTool({ name, arguments: args })).isError, true);
  assert.equal(requests.length, count);
});

test("리다이렉트는 다른 경로로 따라가지 않는다", async () => {
  statusCode = 302;
  responseHeaders = { location: origin + "/uapi/domestic-stock/v1/trading/inquire-balance" };
  const count = requests.length;
  try {
    const response = await call("kis_get_index_price", {});
    assert.equal(response.response.isError, true);
    assert.equal(requests.length, count + 1);
  } finally {
    statusCode = 200;
    responseHeaders = {};
  }
});

test("기본 서버에는 기존 12개와 신규 4개 도구가 유지된다", async () => {
  const fullServer = createServer();
  const fullClient = new Client({ name: "full-tests", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await fullServer.connect(b);
  await fullClient.connect(a);
  try {
    const names = (await fullClient.listTools()).tools.map((t) => t.name);
    assert.equal(names.length, 16);
    assert.ok(names.includes("kis_place_domestic_order"));
    assert.ok(names.includes("kis_get_domestic_balance"));
    payload = { rt_cd: "0", output: { stck_prpr: "70000" } };
    const response = await fullClient.callTool({ name: "kis_get_domestic_stock_price", arguments: { stock_code: "005930" } });
    const data = JSON.parse((response.content as { text: string }[])[0].text);
    assert.equal(data.현재가, "70000");
    assert.equal(data.metadata, undefined);
  } finally {
    await fullClient.close();
    await fullServer.close();
  }
});

test("별도 진입점과 실제 stdio MCP 접속에서도 도구 10개만 노출된다", async () => {
  const stdioClient = new Client({ name: "stdio-tests", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx/esm", "src/market-only.ts"], stderr: "pipe" });
  try {
    await stdioClient.connect(transport);
    assert.deepEqual((await stdioClient.listTools()).tools.map((t) => t.name).sort(), [...MARKET_TOOLS].sort());
    assert.equal((await stdioClient.callTool({ name: "kis_get_domestic_balance", arguments: {} })).isError, true);
  } finally {
    await stdioClient.close();
  }
});
