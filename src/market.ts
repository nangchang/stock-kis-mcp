import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type ApiData = Record<string, unknown>;
export type ApiGet = (env: string, path: string, trId: string, params: Record<string, string>, trCont?: string) => Promise<ApiData>;

export const MARKET_TOOLS = [
  "kis_get_domestic_stock_price", "kis_get_domestic_stock_chart",
  "kis_get_overseas_stock_price", "kis_get_overseas_stock_chart",
  "kis_search_stock", "kis_master_status",
  "kis_get_index_price", "kis_get_market_investor_daily",
  "kis_get_stock_investor_daily", "kis_get_program_trade_daily",
] as const;

export const dateSchema = z.string().regex(/^\d{8}$/).refine((value) => {
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10).replaceAll("-", "") === value;
}, "유효한 날짜 YYYYMMDD가 필요합니다.");
const optionalDate = z.union([dateSchema, z.literal("")]);
const venueSchema = z.enum(["J", "NX", "UN"]);
const stockSchema = z.string().regex(/^[A-Z0-9]{6}$/);
const exchangeSchema = z.enum(["NAS", "NYS", "AMS", "HKS", "SHS", "SZS", "TSE", "HNX", "HSX"]);
const symbolSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9./-]{0,31}$/);
const indexSchema = z.enum(["0001", "1001", "2001"]);
const quotationPath = "/uapi/domestic-stock/v1/quotations/";

interface Endpoint {
  trId: string;
  params: z.ZodTypeAny;
  outputs: string[];
  dateField?: string;
  checkRequestedDate?: boolean;
  required: string[];
}

// 경로뿐 아니라 TR ID, 허용 키, 값까지 인증 전에 검사합니다.
const endpoints: Record<string, Endpoint> = {
  [quotationPath + "inquire-price"]: {
    trId: "FHKST01010100",
    params: z.object({ FID_COND_MRKT_DIV_CODE: venueSchema, FID_INPUT_ISCD: stockSchema }).strict(),
    outputs: ["output"], required: ["stck_prpr"],
  },
  [quotationPath + "inquire-daily-itemchartprice"]: {
    trId: "FHKST03010100",
    params: z.object({
      FID_COND_MRKT_DIV_CODE: venueSchema, FID_INPUT_ISCD: stockSchema,
      FID_INPUT_DATE_1: optionalDate, FID_INPUT_DATE_2: optionalDate,
      FID_PERIOD_DIV_CODE: z.enum(["D", "W", "M", "Y"]), FID_ORG_ADJ_PRC: z.enum(["0", "1"]),
    }).strict(),
    outputs: ["output1", "output2"], dateField: "stck_bsop_date", required: ["stck_bsop_date", "stck_clpr"],
  },
  "/uapi/overseas-price/v1/quotations/price": {
    trId: "HHDFS00000300",
    params: z.object({ AUTH: z.literal(""), EXCD: exchangeSchema, SYMB: symbolSchema }).strict(),
    outputs: ["output"], required: ["last"],
  },
  "/uapi/overseas-price/v1/quotations/dailyprice": {
    trId: "HHDFS76240000",
    params: z.object({
      AUTH: z.literal(""), EXCD: exchangeSchema, SYMB: symbolSchema,
      GUBN: z.enum(["0", "1", "2"]), BYMD: z.literal(""), MODP: z.literal("0"),
    }).strict(),
    outputs: ["output1", "output2"], dateField: "xymd", required: ["xymd", "clos"],
  },
  [quotationPath + "inquire-index-price"]: {
    trId: "FHPUP02100000",
    params: z.object({ FID_COND_MRKT_DIV_CODE: z.literal("U"), FID_INPUT_ISCD: indexSchema }).strict(),
    outputs: ["output"], required: ["bstp_nmix_prpr", "ascn_issu_cnt", "down_issu_cnt", "stnr_issu_cnt"],
  },
  [quotationPath + "inquire-investor-daily-by-market"]: {
    trId: "FHPTJ04040000",
    params: z.object({
      FID_COND_MRKT_DIV_CODE: z.literal("U"), FID_INPUT_ISCD: z.enum(["0001", "1001"]),
      FID_INPUT_DATE_1: dateSchema, FID_INPUT_DATE_2: dateSchema,
      FID_INPUT_ISCD_1: z.enum(["KSP", "KSQ"]), FID_INPUT_ISCD_2: z.enum(["0001", "1001"]),
    }).strict().refine((p) => p.FID_INPUT_DATE_1 === p.FID_INPUT_DATE_2 &&
      p.FID_INPUT_ISCD === p.FID_INPUT_ISCD_2 &&
      p.FID_INPUT_ISCD === (p.FID_INPUT_ISCD_1 === "KSP" ? "0001" : "1001"), "시장·날짜 인수가 일치해야 합니다."),
    outputs: ["output"], dateField: "stck_bsop_date", checkRequestedDate: true,
    required: ["stck_bsop_date", "frgn_ntby_qty", "prsn_ntby_qty", "orgn_ntby_qty", "frgn_ntby_tr_pbmn", "prsn_ntby_tr_pbmn", "orgn_ntby_tr_pbmn"],
  },
  [quotationPath + "investor-trade-by-stock-daily"]: {
    trId: "FHPTJ04160001",
    params: z.object({
      FID_COND_MRKT_DIV_CODE: venueSchema, FID_INPUT_ISCD: stockSchema, FID_INPUT_DATE_1: dateSchema,
      FID_ORG_ADJ_PRC: z.literal(""), FID_ETC_CLS_CODE: z.literal(""),
    }).strict(),
    outputs: ["output1", "output2"], dateField: "stck_bsop_date", checkRequestedDate: true,
    required: ["stck_bsop_date", "frgn_ntby_qty", "prsn_ntby_qty", "orgn_ntby_qty", "frgn_ntby_tr_pbmn", "prsn_ntby_tr_pbmn", "orgn_ntby_tr_pbmn"],
  },
  [quotationPath + "comp-program-trade-daily"]: {
    trId: "FHPPG04600001",
    params: z.object({
      FID_COND_MRKT_DIV_CODE: venueSchema, FID_MRKT_CLS_CODE: z.enum(["K", "Q"]),
      FID_INPUT_DATE_1: dateSchema, FID_INPUT_DATE_2: dateSchema,
    }).strict(),
    outputs: ["output"], dateField: "stck_bsop_date", checkRequestedDate: true,
    required: ["stck_bsop_date", "arbt_smtn_ntby_tr_pbmn", "nabt_smtn_ntby_tr_pbmn"],
  },
};

export function assertMarketRequest(env: string, method: string, path: string, trId: string, params: Record<string, string>, trCont = ""): void {
  if (env !== "real") throw new Error("시장조회 모드는 env='real'만 허용합니다.");
  if (method !== "GET" || !Object.hasOwn(endpoints, path)) throw new Error("시장조회 모드에서 허용하지 않은 요청입니다.");
  const endpoint = endpoints[path];
  if (trId !== endpoint.trId || trCont !== "") throw new Error("허용하지 않은 TR ID 또는 연속조회 인수입니다.");
  endpoint.params.parse(params);
  if (params.FID_INPUT_DATE_2 && params.FID_INPUT_DATE_1 > params.FID_INPUT_DATE_2) {
    throw new Error("시작일은 종료일보다 늦을 수 없습니다.");
  }
}

function rows(value: unknown): ApiData[] {
  if (Array.isArray(value)) return value.filter((v): v is ApiData => !!v && typeof v === "object" && !Array.isArray(v));
  return value && typeof value === "object" ? [value as ApiData] : [];
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function marketEnvelope(env: string, path: string, trId: string, params: Record<string, string>, raw: ApiData | null, trCont = "", error?: string, httpStatus: number | null = null) {
  const endpoint = Object.hasOwn(endpoints, path) ? endpoints[path] : undefined;
  const primary = endpoint ? rows(raw?.[endpoint.outputs.at(-1)!]).filter((r) => Object.values(r).some(present)) : [];
  const dates = [...new Set(primary.map((r) => r[endpoint?.dateField ?? ""]).filter((v): v is string => typeof v === "string" && dateSchema.safeParse(v).success))].sort();
  const requestedDates = Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith("FID_INPUT_DATE_")));
  // 수급의 지정일과 프로그램 단일일자 조회만 검사합니다. 차트 시작일은 범위 경계입니다.
  const requestedDate = endpoint?.checkRequestedDate && params.FID_INPUT_DATE_1 && (!params.FID_INPUT_DATE_2 || params.FID_INPUT_DATE_1 === params.FID_INPUT_DATE_2) ? params.FID_INPUT_DATE_1 : null;
  const datePresent = requestedDate && endpoint?.dateField ? dates.includes(requestedDate) : null;
  const continuation = trCont === "M" || trCont === "F";
  const missingOutput = !!endpoint && endpoint.outputs.some((key) => {
    const value = raw?.[key];
    return !value || typeof value !== "object" || Array.isArray(value) && value.some((r) => !r || typeof r !== "object" || Array.isArray(r));
  });
  const outsideRange = !!params.FID_INPUT_DATE_1 && !!params.FID_INPUT_DATE_2 && dates.some((date) => date < params.FID_INPUT_DATE_1 || date > params.FID_INPUT_DATE_2);
  const incomplete = !!endpoint && (endpoint.outputs.some((key) => !rows(raw?.[key]).some((r) => Object.values(r).some(present))) ||
    primary.some((r) => endpoint.required.some((key) => !present(r[key]))) ||
    (!!endpoint.dateField && primary.some((r) => !dateSchema.safeParse(r[endpoint.dateField!]).success)));
  const failed = !!error || raw?.rt_cd !== "0";
  const status = failed ? "error" : missingOutput || continuation ? "partial" : primary.length === 0 ? "empty" : incomplete || outsideRange || datePresent === false ? "partial" : "ok";
  const venue = ({ J: "KRX", NX: "NXT", UN: "INTEGRATED" } as Record<string, string>)[params.FID_COND_MRKT_DIV_CODE] ?? "unspecified_by_api";
  return {
    metadata: {
      status, source: { provider: "KIS", base_url: "https://openapi.koreainvestment.com:9443", path, tr_id: trId }, environment: env, http_status: httpStatus,
      request_params: { ...params }, requested_dates: requestedDates, response_dates: dates,
      requested_date_present: datePresent, fetched_at: httpStatus === null ? null : new Date().toISOString(), data_as_of: null,
      market_scope: { venue, market_code: params.FID_COND_MRKT_DIV_CODE ?? params.EXCD, index_or_stock_code: params.FID_INPUT_ISCD ?? params.SYMB, board_code: params.FID_MRKT_CLS_CODE ?? params.FID_INPUT_ISCD_1 ?? null },
      units: { monetary: null, quantity: null, conversion_applied: false, note: "단위 미확인: KIS 원문 값 보존, 임의 환산 금지" },
      continuation: { tr_cont: trCont, more_available: continuation },
      warnings: [
        ...(endpoint?.dateField && !dates.length ? ["응답 기준일을 확인할 수 없습니다."] : []),
        ...(datePresent === false ? ["요청한 날짜의 자료가 응답에 없습니다. 다른 날짜를 대체 사용하지 마세요."] : []),
        ...(continuation ? ["추가 조회가 남아 있습니다. 현재 응답은 일부입니다."] : []),
        ...(outsideRange ? ["요청한 날짜 범위 밖의 자료가 포함되어 있습니다."] : []),
        ...(missingOutput || incomplete && primary.length ? ["필수 응답 필드 또는 출력 구역이 누락되었습니다."] : []),
      ],
    },
    raw,
    ...(failed ? { error: { message: error ?? String(raw?.msg1 ?? "KIS 응답 오류"), code: raw?.msg_cd ?? null } } : {}),
  };
}

type Envelope = ReturnType<typeof marketEnvelope>;
const responses = new WeakMap<ApiData, Envelope>();

export function rememberMarketResponse(data: ApiData, env: string, path: string, trId: string, params: Record<string, string>, trCont: string, httpStatus: number): void {
  const { _tr_cont, ...raw } = data;
  responses.set(data, marketEnvelope(env, path, trId, params, raw, trCont, undefined, httpStatus));
}

export class MarketRequestError extends Error {
  constructor(public response: Envelope) {
    super(response.error?.message ?? "시장조회 실패");
  }
}

function result(response: Envelope) {
  return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }], isError: response.metadata.status === "error" };
}

export function marketResult(data: ApiData) {
  return result(responses.get(data)!);
}

export function marketFailure(error: unknown) {
  if (error instanceof MarketRequestError) return result(error.response);
  return { content: [{ type: "text" as const, text: `Error: ${(error as Error).message}` }], isError: true };
}

export function registerMarketTools(server: McpServer, get: ApiGet): void {
  async function query(path: string, params: Record<string, string>) {
    try {
      return marketResult(await get("real", quotationPath + path, endpoints[quotationPath + path].trId, params));
    } catch (error) {
      return marketFailure(error);
    }
  }
  server.tool("kis_get_index_price", "코스피·코스닥·코스피200 현재지수와 상승·하락·보합 종목 수를 조회합니다. 실전 API 전용. 응답에 없는 기준시각은 제공하지 않습니다.", {
    index_code: indexSchema.default("0001").describe("0001(코스피), 1001(코스닥), 2001(코스피200)"),
    env: z.literal("real").default("real"),
  }, async ({ index_code }) => query("inquire-index-price", { FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: index_code }));

  server.tool("kis_get_market_investor_daily", "시장별 투자자매매동향(일별). 요청일과 실제 응답일을 확인하세요. 금액·수량은 원문 단위로 반환합니다. 실전 API 전용.", {
    market: z.enum(["KOSPI", "KOSDAQ"]).default("KOSPI"), date: dateSchema.describe("조회일 YYYYMMDD"),
    env: z.literal("real").default("real"),
  }, async ({ market, date }) => {
    const code = market === "KOSPI" ? "0001" : "1001";
    return query("inquire-investor-daily-by-market", {
      FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: code, FID_INPUT_DATE_1: date,
      FID_INPUT_DATE_2: date, FID_INPUT_ISCD_1: market === "KOSPI" ? "KSP" : "KSQ", FID_INPUT_ISCD_2: code,
    });
  });

  server.tool("kis_get_stock_investor_daily", "종목별 투자자매매동향(일별). 기준일 이전 행이 포함될 수 있습니다. 연속조회가 남으면 partial로 표시합니다. 실전 API 전용.", {
    stock_code: stockSchema.describe("종목코드 6자리"), date: dateSchema.describe("조회 기준일 YYYYMMDD"),
    market: venueSchema.default("J").describe("J(KRX), NX(NXT), UN(통합)"),
    env: z.literal("real").default("real"),
  }, async ({ stock_code, date, market }) => query("investor-trade-by-stock-daily", {
    FID_COND_MRKT_DIV_CODE: market, FID_INPUT_ISCD: stock_code, FID_INPUT_DATE_1: date, FID_ORG_ADJ_PRC: "", FID_ETC_CLS_CODE: "",
  }));

  server.tool("kis_get_program_trade_daily", "코스피·코스닥 프로그램매매 종합현황(일별). 차익·비차익 원문 값을 반환하며 단위를 임의 환산하지 않습니다. 실전 API 전용.", {
    market: z.enum(["KOSPI", "KOSDAQ"]).default("KOSPI"),
    venue: venueSchema.default("J").describe("J(KRX), NX(NXT), UN(통합)"),
    start_date: dateSchema, end_date: dateSchema,
    env: z.literal("real").default("real"),
  }, async ({ market, venue, start_date, end_date }) => query("comp-program-trade-daily", {
    FID_COND_MRKT_DIV_CODE: venue, FID_MRKT_CLS_CODE: market === "KOSPI" ? "K" : "Q",
    FID_INPUT_DATE_1: start_date, FID_INPUT_DATE_2: end_date,
  }));
}
