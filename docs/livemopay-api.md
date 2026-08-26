# LiveMopay web API observations

Internal reference based on an offline inspection of one authenticated LiveMopay portal HAR and the current NewinMeter source. The HAR was inspected on **2026-08-25**. It is a point-in-time observation, not a contract: endpoint availability, fields, and semantics may vary by portal version, account, property, device, or server release.

The source HAR is sensitive. It is intentionally outside this repository and must not be committed, copied into fixtures, or quoted. All identifiers and examples below are placeholders or synthetic. No request was made to LiveMopay or PropertyWallet during this analysis.

Terminology used below:

- **Observed** means the request and response appeared in this HAR.
- **Code-backed** means the behavior is present in the current NewinMeter source.
- **Inferred** means the likely UI trigger or meaning follows from names and response structure but was not independently verified.

## 1. Current NewinMeter integration

NewinMeter currently uses four external operations. The first two are Firebase authentication; the latter two are on the PropertyWallet-hosted LiveMopay API. The application intentionally ingests the ledger and does not use the other observed endpoints.

### Firebase password authentication

- **Method and URL:** `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<firebaseWebApiKey>`
- **Body:** JSON containing `email`, `password`, and `returnSecureToken: true`.
- **Important header:** `Content-Type: application/json`.
- **Purpose:** exchange the credentials supplied during NewinMeter's connection flow for a Firebase ID token and refresh token.
- **Handling:** the password is discarded after this request. The refresh token is encrypted before storage; the ID token is not persisted.
- **Evidence:** `loginWithLiveMopayCredentials` in `src/lib/newinmeter/web.ts` and `POST /api/livemopay/connect`.

This exchange was not present in the supplied HAR, which began from an already authenticated portal session.

### Firebase refresh-token exchange

- **Method and URL:** `POST https://securetoken.googleapis.com/v1/token?key=<firebaseWebApiKey>`
- **Body:** form-encoded `grant_type=refresh_token` and `refresh_token=<encrypted-at-rest user token after decryption>`.
- **Important header:** `Content-Type: application/x-www-form-urlencoded`.
- **Purpose:** obtain a fresh Firebase ID token immediately before a sync. A rotated refresh token is encrypted and stored in place of the previous one.
- **Evidence:** `refreshLiveMopaySession` in `src/lib/newinmeter/web.ts` and `runLivemopaySync` in `src/lib/newinmeter/sync.ts`.

This exchange was also not present in the supplied HAR.

### LiveMopay account discovery

- **Method and path:** `GET https://app.propertywallet.co.za/mobile/` (trailing slash).
- **Important code-supplied headers:** `Authorization: Bearer <Firebase ID token>`, `Accept: */*`, `appflavor: livemopay`, portal `Origin` and `Referer`, `Accept-Language`, browser fetch metadata, and a browser-like `User-Agent`. When available in JWT claims, `companyid` and `propertyid` are also supplied. `accountid` is deliberately omitted because it is the value being discovered.
- **Purpose:** discover account candidates during `POST /api/livemopay/connect`. NewinMeter accepts an array or one object, finds account/company/property IDs defensively, and either connects the sole candidate or asks the user to select from labels.
- **Current uncertainty:** this exact discovery request was not captured in the HAR. The current response parser is code-backed but its real multi-account response shape remains unverified.

Do not confuse `GET /mobile/` with the observed account-detail routes `GET /mobile/{accountId}` and `GET /mobile/all`.

### LiveMopay ledger retrieval

- **Method and path:** `GET https://app.propertywallet.co.za/mobile/ledger/{startDate}?accountId=<accountId>`.
- **Important code-supplied headers:** the shared authenticated headers above plus `accountid`, `companyid`, and `propertyid`.
- **Purpose:** NewinMeter's primary and only current LiveMopay ingestion source. Full sync uses a deliberately early start date; incremental sync starts from the most recent stored period date, or the beginning of the current local year when no history exists.
- **Normalization:** NewinMeter parses energy (`kWh`), water (`kL`), fixed charges, wallet top-ups, and refunds from ledger descriptions and unit strings, then deduplicates and upserts connection-scoped rows.
- **Evidence:** observed in the HAR and implemented by `fetchLiveMopayLedger` and `runLivemopaySync`.

The HAR did not expose an `Authorization` header on its portal API entries. That may reflect the export/capture mechanism; it does not override the current code, which explicitly sends a bearer ID token. The HAR did consistently expose `accountid`, `companyid`, `propertyid`, `appflavor`, portal `Origin`/`Referer`, and browser request headers. No authentication requirement should be weakened based on the missing HAR header.

## 2. Observed LiveMopay API endpoint catalogue

Ten PropertyWallet API paths and the portal's `version.json` were captured. All captured API calls used `GET`, returned HTTP 200 JSON, and carried the account/company/property and portal-context headers described above unless noted. UI triggers below are inferences from request names, shapes, and capture sequence.

### `GET /mobile/{accountId}`

- **Query parameters:** none.
- **Likely UI trigger (inferred):** account/home overview loading or refresh.
- **Purpose:** compact account overview plus attached device summaries.
- **Response shape:** one object with account identity and balance fields, company/property references, last-update information, and `devices[]`.
- **Notable device fields:** device reference/number, industry ID/name, SI unit, smart/prepaid/STS flags, remote STS capability, live-monitor capability, generator opt-in, and credit-balance information.
- **Currently used by NewinMeter:** no. Account discovery currently calls `/mobile/`, not this account-specific route.
- **Possible future usefulness:** capability detection and user-facing device selection. It should not be adopted without testing across different device/account types.

### `GET /mobile/transactions?accountId=<accountId>`

- **Important query parameter:** `accountId`.
- **Additional request header:** `pagination`, encoded as JSON. The request shape uses lower-camel-case keys such as `currentIndex`, `itemsPerIndex`, `totalItems`, `sortColumn`, and `sortAscending`. The response `pagination` header uses corresponding PascalCase keys. A sanitized example is shown in [Transactions](#8-transactions).
- **Likely UI trigger (inferred):** purchase/vend transaction history and page changes.
- **Purpose and response:** a paginated array of detailed vend/purchase objects; see [Transactions](#8-transactions).
- **Currently used by NewinMeter:** no.
- **Possible future usefulness:** richer top-up/vend breakdown than ledger credits can provide.

### `GET /aopay/pending?accountId=<accountId>`

- **Important query parameter:** `accountId`.
- **Likely UI trigger (inferred):** payment/top-up screen checking pending AO Pay operations.
- **Observed response shape:** an empty array in this capture. The element schema and status semantics are therefore unknown.
- **Currently used by NewinMeter:** no.
- **Possible future usefulness:** none identified for current meter analytics; do not consume without a defined product need.

### `GET /mobile/device/{deviceId}/smart-summary`

- **Path parameter:** device ID.
- **Likely UI trigger (inferred):** opening or refreshing a smart-device summary.
- **Purpose and response:** device consumption summary, readings, tariff metadata, and deductions; see [`smart-summary`](#5-smart-summary).
- **Currently used by NewinMeter:** no.
- **Possible future usefulness:** official tariff labels/link and structured readings.

### `GET /mobile/saved-cards`

- **Likely UI trigger (inferred):** purchase/payment-method screen.
- **Purpose:** retrieve stored-card metadata for portal payments.
- **Response shape:** an array containing cardholder/display metadata and internal card/payment references. No values are reproduced here.
- **Currently used by NewinMeter:** no, intentionally.
- **Future usefulness:** none. This is out of scope; see [Sensitive / intentionally unused endpoints](#10-sensitive--intentionally-unused-endpoints).

### `GET /mobile/load_profile?deviceId=<deviceId>&fromDate=<fromDate>&toDate=<toDate>&typeId=<typeId>&groupBy=<groupBy>`

- **Important query parameters:** `deviceId`, date range, numeric `typeId`, and grouping.
- **Observed grouping values:** `daily`, `hourly`, and `none` (the latter appears raw-ish relative to the grouped responses).
- **Observed type IDs:** `1`, `2`, `3`, `4`, `6`, `7`, and `8`. Their exact semantic mapping is unknown. The capture associates them with response units including `kWh`, `kVA`, and `kW`, but units alone do not establish meaning.
- **Likely UI trigger (inferred):** load-profile chart range, measurement, and grouping changes.
- **Purpose and response:** detailed consumption/demand series and aggregate metrics; see [`load_profile`](#6-load_profile).
- **Currently used by NewinMeter:** no.
- **Possible future usefulness:** detailed charting, demand analytics, solar import/export/net analysis, and device-level comparisons after semantics are confirmed.

### `GET /mobile/summary/all/{fromDate}/{toDate}?accountId=<accountId>`

- **Path/query parameters:** inclusive or otherwise bounded date range semantics are not established; `accountId` is required by the observed calls.
- **Likely UI trigger (inferred):** account summary/dashboard range loading.
- **Purpose and response:** `devices[]` with structured readings and `summaries[]` with aggregate financial categories; see [Ledger versus summary](#3-mobileledger-versus-mobilesummaryall).
- **Currently used by NewinMeter:** no.
- **Possible future usefulness:** cleaner structured physical consumption, cross-checking, and account-level aggregates. It is not a drop-in ledger replacement.

### `GET /notifications`

- **Additional request header:** the same JSON `pagination` header shape used by transactions.
- **Likely UI trigger (inferred):** notification list or notification badge loading.
- **Purpose and response:** paginated notification records; see [Notifications](#9-notifications).
- **Currently used by NewinMeter:** no.
- **Possible future usefulness:** limited; NewinMeter already has its own alert/notification model, and upstream messages may contain sensitive account context.

### `GET /mobile/all`

- **Likely UI trigger (inferred):** authenticated user/account initialization or account selection.
- **Purpose and response:** a broad array of mobile-user/account links with deeply nested account, account-holder, property, company-reference, provider, notification, billing, payment, and configuration data. This response is substantially more sensitive and expansive than `/mobile/{accountId}`.
- **Currently used by NewinMeter:** no.
- **Possible future usefulness:** it may prove to be a canonical account-discovery source, but this is unconfirmed. Any future parser should select only the minimum necessary fields and never log the payload.

### `GET /mobile/ledger/{startDate}?accountId=<accountId>`

- **Path/query parameters:** start date and account ID.
- **Likely UI trigger:** ledger/history view; it is also NewinMeter's sync source.
- **Response shape:** an array with `date`, `description`, `unitsDescription`, debit, credit, and balance fields. Amount fields appeared in base and `Incl` variants and were represented as strings.
- **Notable content:** timestamped consumption charges, tariff/rate-bearing unit strings, fixed charges, credits/top-ups, refunds, and running balances.
- **Currently used by NewinMeter:** yes, as the primary ingestion endpoint.
- **Possible future usefulness:** remains the authoritative input to the current billing/transaction-oriented ingestion. No architecture change is recommended from this HAR.

### `GET https://app.livewalletportal.co.za/version.json?cachebuster=<value>`

- **Authentication/account headers:** none observed or expected for this static portal asset.
- **Response shape:** `app_name`, `package_name`, and `version` strings.
- **Currently used by NewinMeter:** no.
- **Observed version:** see [LiveMopay portal version](#11-livemopay-portal-version).

## 3. `/mobile/ledger` versus `/mobile/summary/all`

The ledger remains NewinMeter's primary source. It represents billing and wallet events at transaction/charge level:

- timestamped energy and water charges;
- consumption embedded in descriptions and unit strings;
- tariff/rate values;
- debits, credits, and running balances;
- fixed charges;
- wallet top-ups and refunds; and
- potentially multiple tariff charge rows for one physical consumption interval.

`/mobile/summary/all` represents a different projection. Its observed top-level response contains:

- `devices[]`, each with a display name, industry name, and structured `readings[]`;
- electricity and water reading series with timestamps, consumption, and time-of-use metadata; and
- `summaries[]` with `description`, excluding-VAT amount, VAT, total, optional unit description, and optional balance date.

The captured summary categories included opening and closing balance concepts plus aggregated charges, credits/top-ups, water, and balance information. Category availability may vary; the capture does not establish an exhaustive enum.

**Conclusion:** `/mobile/summary/all` is not currently considered a drop-in replacement for `/mobile/ledger`. The summary may offer cleaner **consumption truth**, while the ledger offers richer **billing/transaction truth**. NewinMeter should not change ingestion architecture on the evidence of one capture.

## 4. Structured consumption observations

The structured reading form observed in both summary-oriented endpoints is conceptually:

```json
{
  "readOn": "2099-01-01T00:00:00Z",
  "consumptionValue": 1.23,
  "timeOfUseSlotId": 1,
  "timeOfUseSlotName": "Synthetic slot"
}
```

The timestamp, value, slot ID, and slot name above are synthetic.

In an offline comparison, structured electricity consumption aligned with ledger-derived consumption for every overlapping reading in this capture. The comparison used the consumption quantity parsed from ledger unit strings and grouped ledger rows by their embedded consumption-interval timestamp.

The capture also demonstrated an important tariff-split behavior: a single 30-minute physical consumption interval can produce multiple ledger billing rows when a tariff changes during that interval. Those ledger rows have different rates; their consumption quantities sum to the single structured interval consumption value. This is why the two endpoints model different concepts rather than merely presenting the same rows in different formats.

This result is evidence from one account and capture, not a guarantee for every device, interval, or property.

## 5. `smart-summary`

`GET /mobile/device/{deviceId}/smart-summary` returned one object with:

- `readings[]` containing `readOn`, `consumptionValue`, `timeOfUseSlotId`, and `timeOfUseSlotName` (plus an internal reading ID);
- `consumptionTotal`;
- `deductionsTotal`;
- `consumptionTypeName`;
- `tariffName`; and
- `tariffHyperLink`.

This endpoint potentially exposes official tariff name and hyperlink metadata that NewinMeter currently derives only indirectly from ledger descriptions and unit rates. Whether the hyperlink is stable, public, or present across tariffs is unknown. The endpoint is not currently used.

## 6. `load_profile`

The observed request supports date-bounded, device-specific measurement series:

```text
GET /mobile/load_profile
  ?deviceId=<deviceId>
  &fromDate=<fromDate>
  &toDate=<toDate>
  &typeId=<numericTypeId>
  &groupBy=daily|hourly|none
```

The response contained:

- identity/selection metadata: `industryId`, `typeId`;
- series: `readings`, `weekReadings`, and an observed but empty `deviceReadings` array;
- reading fields: timestamp, SI unit, consumption, previous-period/week values, net consumption, export consumption, kWh value, maximum demand, and optional time-of-use fields;
- totals: total consumption, total net consumption, total export consumption, and total kWh consumption;
- time-of-use aggregates: peak, standard, and off-peak consumption and percentages, plus fields for category maxima and timestamps;
- demand metrics: `maximumDemand` and `maximumDemandOn`;
- load-factor fields for kWh and kVA; and
- optional billing-indicator fields and a `showBillingIndicators` flag.

The `weekReadings` shape was an array of arrays containing day/date, day-of-week label, SI unit, and consumption value.

Observed units included `kWh`, `kVA`, and `kW`. Observed `typeId` values were `1`, `2`, `3`, `4`, `6`, `7`, and `8`, but the HAR does not prove what each ID means. In particular, a response unit is insufficient to distinguish concepts such as import, export, net, apparent power, active power, or another portal-selected series. Keep the mapping unknown until supported by stronger evidence.

The `none` grouping returned a denser series than `hourly`, which in turn was denser than `daily`; calling it “raw-ish” is an inference, not a guarantee of raw meter resolution.

## 7. Account/device metadata

The HAR supports this apparent relationship:

```text
LiveMopay user
└── account link(s)
    └── account
        └── property / company context
            └── device(s)
```

`/mobile/{accountId}` is the compact operational view: account balances/status plus devices. `/mobile/all` is the expansive user/account graph: mobile-user/account link records containing nested account, account-holder, property, and configuration data. The exact ownership/cardinality rules are not established by one capture.

Capability/configuration concepts present across these responses included:

- electricity/water industry type and SI unit;
- smart-device, prepaid, and STS status;
- remote STS-token delivery capability;
- live monitoring, solar monitoring, and generator opt-in;
- normal and prepaid data-retrieval intervals plus retry settings;
- first/second balance-notification thresholds and VAT-inclusion behavior;
- fixed-charge pro-rating and utility billing behavior;
- service-charge configuration and third-party payment behavior; and
- minimum/maximum purchase configuration and card-purchase prevention.

These are observed field capabilities, not assertions about any particular user's settings. `/mobile/all` also contains personal, financial, notification-delivery, and property data that NewinMeter does not need and must not retain or log.

## 8. Transactions

`GET /mobile/transactions` exposes richer purchase/vend detail than can be reconstructed from ledger credits. Observed fields included:

- vend date, units, SI unit, and average unit rate;
- unit-charge subtotal, VAT, and total;
- service-charge rate/subtotal/VAT/total;
- third-party, fixed-charge, and arrears subtotals/VAT/totals;
- overall subtotal, VAT, and total;
- vendor name and device reference; and
- receipt-message and internal transaction fields.

The request and response use a JSON-valued `pagination` header. This sanitized request example shows the shape only:

```json
{
  "currentIndex": 0,
  "itemsPerIndex": 10,
  "totalItems": 0,
  "sortColumn": "vendDate",
  "sortAscending": false
}
```

The response header uses `CurrentIndex`, `ItemsPerIndex`, `TotalItems`, `SortColumn`, and `SortAscending`. Exact page-size and total behavior should be treated as unverified beyond this shape.

Prepaid STS token data appeared in the transaction payload. It must never be copied into documentation, logs, tests, or fixtures. No token or token fragment is reproduced here.

This endpoint is not currently used. It may be useful for a future purchase breakdown, but only with a deliberately minimal schema that excludes vend tokens and unnecessary payment metadata.

## 9. Notifications

`GET /notifications` returned a paginated array. Each observed record had:

- notification ID;
- title and body;
- numeric type and type name;
- read state; and
- file ID/downloaded state where applicable.

The request/response pagination header follows the same lower-camel-case/PascalCase pattern documented for transactions. Real notification text is intentionally omitted because it may contain account-specific details. NewinMeter does not currently use this endpoint.

## 10. Sensitive / intentionally unused endpoints

Endpoint discovery does not imply that NewinMeter should consume an endpoint.

- **`/mobile/saved-cards` is explicitly out of scope.** It exposes stored-card metadata, including cardholder/display fields and payment references. NewinMeter has no product need for it and should not request, store, log, document, or fixture its payload.
- **`/mobile/transactions` requires data minimization if ever adopted.** STS token fields must be excluded at the boundary.
- **`/mobile/all` is unusually broad.** It includes personal, property, bank/payment-configuration, notification-delivery, and internal operational fields. It should not be used merely because it exists; any future discovery use should extract only account-selection fields.
- **`/notifications` can contain account-specific free text.** Do not ingest it without a defined need and retention policy.
- **`/aopay/pending` has no current analytics purpose.** Its empty captured response does not justify probing its schema.

## 11. LiveMopay portal version

The captured `GET /version.json` response reported portal version **6.3.1**. This was observed during the HAR inspected on **2026-08-25**. It is not an API version declaration or a guarantee that the endpoint shapes documented here remain stable in later portal releases.

## 12. Open questions

- Is `/mobile/all` the canonical account-discovery endpoint, and how does it relate to the current code's `GET /mobile/` discovery call?
- How stable are these paths, headers, and response shapes across LiveMopay portal versions?
- What is the exact semantic meaning of each `load_profile` `typeId`?
- Are structured consumption readings consistently available for all properties, industries, and smart/non-smart or prepaid/postpaid device types?
- How far back can `summary/all` and `load_profile` query, and are date boundaries inclusive?
- Does LiveMopay return different account, device, or summary shapes for non-smart, non-prepaid, water-only, solar, or generator-enabled installations?
- Which source should be considered authoritative when structured physical consumption and billed ledger quantities disagree?
- Are tariff hyperlinks and time-of-use identifiers stable identifiers or presentation metadata?
- Why was the bearer authorization header absent from this HAR export even though current NewinMeter code supplies it?
