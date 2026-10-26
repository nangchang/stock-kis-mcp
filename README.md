# 한국투자증권 KIS MCP Server

한국투자증권 Open API를 Claude에서 직접 사용할 수 있는 MCP 서버입니다.

## 사전 준비

1. [KIS Developers](https://apiportal.koreainvestment.com) 에서 앱키/앱시크리트 발급
2. Node.js 22+ 및 npm 설치

## 환경변수 설정

```bash
# 실전투자 (필수)
export KIS_APP_KEY="your_app_key"
export KIS_APP_SECRET="your_app_secret"
export KIS_ACCOUNT_NO="12345678"     # 계좌번호 앞 8자리
export KIS_ACCOUNT_PROD="01"         # 계좌상품코드 (기본값: 01)

# 모의투자 (선택)
export KIS_PAPER_APP_KEY="your_paper_app_key"
export KIS_PAPER_APP_SECRET="your_paper_app_secret"
export KIS_PAPER_ACCOUNT_NO="12345678"
```

## 빌드 및 실행

```bash
npm install
npm run build
```

## Claude Code 설정 (.mcp.json)

프로젝트 루트 또는 `~/.claude/` 에 추가:

```json
{
  "mcpServers": {
    "kis": {
      "command": "node",
      "args": ["/path/to/koreainvestment-mcp/dist/index.js"],
      "env": {
        "KIS_APP_KEY": "your_app_key",
        "KIS_APP_SECRET": "your_app_secret",
        "KIS_ACCOUNT_NO": "12345678",
        "KIS_PAPER_APP_KEY": "your_paper_app_key",
        "KIS_PAPER_APP_SECRET": "your_paper_app_secret",
        "KIS_PAPER_ACCOUNT_NO": "12345678"
      }
    }
  }
}
```

개발 중에는 `tsx`로 직접 실행 가능:

```json
{
  "mcpServers": {
    "kis": {
      "command": "npx",
      "args": ["tsx", "/path/to/koreainvestment-mcp/src/index.ts"],
      "env": { "...": "..." }
    }
  }
}
```

## 제공 도구 (기본 실행: 16개)

| 도구 | 설명 | 읽기전용 |
|------|------|:---:|
| `kis_get_domestic_stock_price` | 국내주식 현재가 조회 | ✅ |
| `kis_get_domestic_stock_chart` | 국내주식 일/주/월별 시세 | ✅ |
| `kis_get_domestic_balance` | 국내주식 잔고 조회 | ✅ |
| `kis_get_account_assets` | 투자계좌 자산 현황 (실전 전용) | ✅ |
| `kis_place_domestic_order` | 국내주식 현금 주문 | ❌ |
| `kis_revise_or_cancel_domestic_order` | 국내주식 주문 정정/취소 | ❌ |
| `kis_get_overseas_stock_price` | 해외주식 현재가 조회 | ✅ |
| `kis_get_overseas_stock_chart` | 해외주식 일/주/월별 시세 | ✅ |
| `kis_get_overseas_balance` | 해외주식 잔고 조회 | ✅ |
| `kis_place_overseas_order` | 해외주식 주문 | ❌ |
| `kis_search_stock` | 종목코드·종목명 검색 | ✅ |
| `kis_master_status` | 종목 마스터 DB 현황 | ✅ |
| `kis_get_index_price` | 지수와 상승·하락·보합 종목 수 (실전 API) | ✅ |
| `kis_get_market_investor_daily` | 시장별 투자자 수급 (일별, 실전 API) | ✅ |
| `kis_get_stock_investor_daily` | 종목별 투자자 수급 (일별, 실전 API) | ✅ |
| `kis_get_program_trade_daily` | 프로그램매매 종합현황 (일별, 실전 API) | ✅ |

## 시장조회 전용 실행 (10개 도구)

브리핑 수집에는 별도 진입점 `dist/market-only.js`를 사용합니다. 기존 `dist/index.js`는 계좌·주문 기능을 포함한 기본 실행을 유지합니다.

```bash
export KIS_APP_KEY="your_app_key"
export KIS_APP_SECRET="your_app_secret"
npm run build
npm run start:market
# 개발: npm run dev:market
```

시장조회 모드는 `env="real"`만 허용하며 계좌번호나 모의투자 인증정보가 필요하지 않습니다. 국내·해외 현재가와 차트 4개, 종목 검색·마스터 현황 2개, 신규 API 4개만 등록합니다. 신규 API는 기본 실행에서도 사용할 수 있습니다.

```json
{
  "mcpServers": {
    "kis-market": {
      "command": "node",
      "args": ["/path/to/koreainvestment-mcp/dist/market-only.js"],
      "env": {
        "KIS_APP_KEY": "your_app_key",
        "KIS_APP_SECRET": "your_app_secret"
      }
    }
  }
}
```

신규 도구 호출 인수 (`env`는 `real`이 기본값):

| 도구 | 예시 인수 | 공식 API / TR ID |
|------|-----------|-----------------|
| `kis_get_index_price` | `{"index_code":"0001"}` | [inquire-index-price](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_index_price/inquire_index_price.py) / `FHPUP02100000` |
| `kis_get_market_investor_daily` | `{"market":"KOSPI","date":"20261023"}` | [inquire-investor-daily-by-market](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_investor_daily_by_market/inquire_investor_daily_by_market.py) / `FHPTJ04040000` |
| `kis_get_stock_investor_daily` | `{"stock_code":"005930","date":"20261023","market":"J"}` | [investor-trade-by-stock-daily](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/investor_trade_by_stock_daily/investor_trade_by_stock_daily.py) / `FHPTJ04160001` |
| `kis_get_program_trade_daily` | `{"market":"KOSPI","venue":"J","start_date":"20261023","end_date":"20261023"}` | [comp-program-trade-daily](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/comp_program_trade_daily/comp_program_trade_daily.py) / `FHPPG04600001` |

지수코드는 `0001`(코스피), `1001`(코스닥), `2001`(코스피200)을 지원합니다. 수급·프로그램의 시장은 `KOSPI`/`KOSDAQ`, 거래소 범위는 `J`(KRX)/`NX`(NXT)/`UN`(통합)입니다. 업종코드 `U`를 사용하는 지수·시장별 수급 API는 거래소 선택 인수가 없어 `venue="unspecified_by_api"`로 표시합니다. 서로 다른 범위의 수치를 같은 모집단으로 비교하지 마세요. 해외 시세 도구는 `NAS/NYS/AMS/HKS/SHS/SZS/TSE/HNX/HSX` 코드를 사용합니다.

### HTTP 요청 제한

시장조회 클라이언트는 위 신규 4종과 기존 시세 4종의 정확한 GET 경로·TR ID·인수만 허용합니다. 날짜 형식과 실제 날짜, 기간 순서, 시장코드 조합, 추가 인수를 인증정보 확인 및 토큰 발급 전에 검사합니다. 일반 API POST는 차단하며, 토큰 발급 함수만 고정된 `/oauth2/tokenP` 경로와 인증 본문으로 POST합니다. 리다이렉트는 따라가지 않습니다.

종목 검색의 마스터 파일은 기존에 지정된 HTTPS URL에서 GET으로 내려받습니다. 인증서·호스트 검증에 실패하면 갱신을 중단하고 기존 캐시와 갱신일을 유지합니다. 검색 응답의 `마스터_갱신상태`에서 실패·캐시 유무·갱신일을 확인할 수 있습니다. 별도 신뢰 CA가 필요한 환경은 확인한 CA를 Node의 `NODE_EXTRA_CA_CERTS`로 지정하세요. `src/fixtures/localhost-*.pem`은 로컬 TLS 회귀 시험 전용입니다.

이 제한은 시장조회 MCP 진입점의 도구와 HTTP 클라이언트에 적용됩니다. 기본 진입점의 계좌·주문 권한은 그대로이므로 브리핑 설정에는 시장조회 진입점을 지정해야 합니다.

### 브리핑 응답 해석과 보관

시장조회 모드의 시세 4종과 신규 API 4종은 `metadata`와 `raw`를 반환합니다. 신규 API는 기본 실행에서도 같은 형식입니다. `raw`에는 KIS 응답 필드와 문자열 값을 그대로 보존합니다.

- `metadata.status`: `ok`(필수 필드 확인), `empty`(자료 행 없음), `partial`(누락 필드·요청일 자료 누락·범위 밖 자료·연속조회 잔여), `error`(인증·HTTP·KIS·입력 오류). 오류는 MCP `isError=true`로도 표시합니다. 빈 응답을 휴장이나 순매수 0으로 해석하지 마세요.
- `request_params`와 `requested_dates`: 실제 요청 인수·날짜. `response_dates`: 데이터 행의 `stck_bsop_date` 또는 `xymd`에서 확인한 날짜. `requested_date_present`는 수급 지정일·프로그램 단일일자 조회에서 검사하며, `false`이면 이전 거래일 자료를 요청일 자료로 대신 쓰지 마세요. 차트 날짜는 조회 범위의 경계이므로 이 값은 `null`이며 시작일에 봉이 없어도 정상 응답일 수 있습니다.
- `fetched_at`: HTTP 응답 처리 완료 시각(UTC ISO 형식), 응답 수신 전 실패 시 `null`. `data_as_of`: 확인 가능한 응답 기준시각이 없어 `null`. 조회 시각이나 HTTP Date를 데이터 기준시각으로 사용하지 않습니다.
- `units`: 금액·수량 단위는 확인 전까지 `null`, `conversion_applied=false`. 원문 숫자를 원·천주·억 원 등으로 임의 환산하지 않습니다.
- `source`: KIS 호스트·경로·TR ID. `market_scope`: 요청한 시장·거래소 범위. `continuation`: 응답의 `tr_cont`와 추가 자료 유무. 자동 연속조회는 수행하지 않습니다.

수집·검증 담당은 이 JSON 전체를 보관하고 요청일·응답일·범위·상태를 확인한 뒤 브리핑에 사용해야 합니다. 서버는 별도 브리핑 저장소나 담당 에이전트에 자동 연결하거나 원응답 파일을 저장하지 않습니다. 검색·마스터 도구는 로컬 캐시 상태 형식을 유지합니다.

### 검증

```bash
npm run build
npm test
```

단위 시험은 모의 HTTP 응답, 실제 stdio MCP 연결, 로컬 HTTPS 서버로 10개 도구 노출·요청 차단·응답 메타데이터·인증서 검증·캐시 보존을 확인합니다. 로컬 HTTPS 시험에는 루프백 서버를 열 수 있는 실행 환경이 필요합니다.

실제 시장자료 확인은 별도 스크립트를 사용합니다. 확인 가능한 거래일을 직접 지정하세요. 앱키·시크리트 또는 거래일이 없으면 건너뜁니다.

```bash
KIS_MARKET_TEST_DATE=20261023 npm run test:market:integration
```

이 시험은 신규 시장 API 4종만 조회합니다. 기존 `test:integration`은 계좌 잔고 조회를 포함하므로 브리핑 점검용으로 사용하지 않습니다.

## 주의사항

- `env="real"` 주문 도구는 **실제 자금**이 사용됩니다. 테스트는 반드시 `env="demo"`를 사용하세요.
- 주문 도구의 기본값은 `env="demo"`(모의투자)로 설정되어 있습니다.
- 실전투자와 모의투자의 앱키/계좌번호는 별개입니다.
- 토큰은 프로세스 메모리에 캐시되며 만료 5분 전에 자동 재발급됩니다.
- 종목 마스터 데이터는 `~/.kis_mcp/master.db`에 저장되며 하루 1회 자동 갱신됩니다.
