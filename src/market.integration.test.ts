/** 실전 시장자료만 조회합니다. 계좌·잔고·주문 API는 호출하지 않습니다. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "./index.js";
import { dateSchema, marketResult } from "./market.js";

const date = process.env.KIS_MARKET_TEST_DATE ?? "";
const skip = !process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET
  ? "KIS_APP_KEY / KIS_APP_SECRET 미설정"
  : !date ? "KIS_MARKET_TEST_DATE에 확인할 거래일 YYYYMMDD를 지정하세요." : false;
const api = createApiClient("market");
const prefix = "/uapi/domestic-stock/v1/quotations/";

const cases: { name: string; path: string; trId: string; params: Record<string, string> }[] = [
  { name: "지수", path: "inquire-index-price", trId: "FHPUP02100000", params: { FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: "0001" } },
  { name: "시장별 투자자 수급", path: "inquire-investor-daily-by-market", trId: "FHPTJ04040000", params: {
    FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: "0001", FID_INPUT_DATE_1: date, FID_INPUT_DATE_2: date, FID_INPUT_ISCD_1: "KSP", FID_INPUT_ISCD_2: "0001",
  } },
  { name: "종목별 투자자 수급", path: "investor-trade-by-stock-daily", trId: "FHPTJ04160001", params: {
    FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: "005930", FID_INPUT_DATE_1: date, FID_ORG_ADJ_PRC: "", FID_ETC_CLS_CODE: "",
  } },
  { name: "프로그램매매", path: "comp-program-trade-daily", trId: "FHPPG04600001", params: {
    FID_COND_MRKT_DIV_CODE: "J", FID_MRKT_CLS_CODE: "K", FID_INPUT_DATE_1: date, FID_INPUT_DATE_2: date,
  } },
];

for (const fixture of cases) {
  test(`실전 시장조회: ${fixture.name}`, { skip, timeout: 45_000 }, async () => {
    dateSchema.parse(date);
    const data = await api.apiGet("real", prefix + fixture.path, fixture.trId, fixture.params);
    const response = marketResult(data);
    const envelope = JSON.parse(response.content[0].text);
    assert.equal(response.isError, false, JSON.stringify(envelope.error));
    assert.ok(["ok", "partial"].includes(envelope.metadata.status), `자료 없음: ${envelope.metadata.status}`);
    assert.equal(envelope.raw.rt_cd, "0");
    if (fixture.name !== "지수") {
      assert.equal(envelope.metadata.requested_date_present, true, `요청일 ${date} 자료가 응답에 없습니다.`);
    }
  });
}
