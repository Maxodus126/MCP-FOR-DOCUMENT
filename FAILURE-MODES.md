# Failure mode and effects analysis (FMEA)

| Failure mode | Trigger / symptom | Existing mitigation | Residual risk | Operator action |
|---|---|---|---|---|
| npm registry unavailable | `EAI_AGAIN`, `ECONNRESET` during install | Pinned direct dependency versions; install scripts | No offline dependency bundle | Restore DNS/proxy access, then rerun `npm install` |
| Wrong Node version | SDK/child-process runtime errors | Engine constraint and doctor check | Host may bypass scripts | Install Node 22 LTS |
| MCP process not launched | Tool list empty / server offline | Absolute executable/path examples; doctor/smoke | Client config syntax differs by version | Run `npm run smoke`, inspect MCP client logs |
| Allowlist misconfigured | `CONFIG_INVALID`, `PATH_OUTSIDE_ALLOWLIST` | Startup validation and canonical path checks | Environment differs between terminal and desktop client | Set `ALLOWED_DIRS` explicitly in MCP client config |
| File replaced during read | `FILE_CHANGED_DURING_ACCESS` | Snapshot stat, open flags, revalidation | Parent-dir/hardlink races cannot be fully eliminated | Copy document to controlled read-only folder and retry |
| Extension spoofing | `FILE_SIGNATURE_MISMATCH` | Magic/signature precheck and ZIP package validation | CSV has no universal magic signature | Re-export document in genuine format |
| PDF malformed/encrypted | `PDF_PARSE_FAILED` | Child-process timeout and sanitized error | Password-protected PDF not supported | Remove password using authorized workflow or provide unlocked copy |
| PDF scan-only | Empty/near-empty extracted text | Per-page warnings | OCR not implemented | OCR separately, then provide searchable PDF |
| PDF too many pages | `PDF_PAGE_LIMIT` | Configurable hard page cap | Metadata page count may be unknown | Split PDF into smaller files |
| PDF extraction slow | `PROCESSING_TIMEOUT` | Child-process timeout and V8 heap limit | Parser can still consume CPU until timeout | Reduce file/range, lower concurrency, inspect file |
| DOCX unsupported feature | Mammoth warning or missing layout | Warning output, HTML-to-Markdown conversion | Headers/footers, textboxes, complex layout may be incomplete | Export to PDF or simplify DOCX |
| XLSX ZIP bomb | `OFFICE_EXPANSION_LIMIT` / ratio error | Actual decompression measurement, CRC and child process | ZIP preflight itself costs CPU/RAM | Reject file; do not disable guard |
| XLSX memory spike | `WORKER_CRASHED` | Child-process V8 heap limit and ZIP expansion cap | ExcelJS object overhead and native memory | Reduce workbook size, use CSV, concurrency=1 |
| Formula result absent | Formula returned as `=...` | Cached result used if present | No spreadsheet formula calculation engine | Recalculate/save workbook in Excel/LibreOffice first |
| CSV encoding/delimiter issue | Garbled text or merged columns | UTF-8/UTF-16 BOM support; comma/semicolon/tab/pipe detection | Legacy encodings (e.g. Windows-1252) not auto-detected | Save as UTF-8 CSV and inspect the first row |
| Excel search incomplete | Search warning about scan rows/columns | Configurable scan bounds | Match beyond scan cap is not found | Raise scan bounds carefully or split sheet |
| Queue saturation | `SERVER_BUSY` / `QUEUE_TIMEOUT` | Bounded queue, queue wait deadline, abortable semaphore | User sees temporary failure | Retry later, reduce parallel calls, or adjust `MAX_QUEUE_WAIT_MS` carefully |
| Client cancellation | `REQUEST_CANCELLED` | AbortSignal removes queued job / terminates child process | Cancellation may race with parser completion | Retry if result is still needed |
| Parser child crash | `WORKER_CRASHED` | Per-job child process and error isolation | Native library crash should terminate only the parser child; OS-wide memory pressure can still affect the host | Retry once; inspect OS logs; apply container/OS quotas for untrusted data |
| Parser child startup/IPC failure | `WORKER_START_FAILED` / `WORKER_IPC_FAILED` | Sanitized error response and bounded child lifecycle | OS process limits or missing runtime files can block parser launch | Check Node installation, file permissions, and `npm run doctor` |
| Tool output truncated | Truncation marker | Character cap and row/page limits | Client token budget may be lower | Request smaller sections or lower `maxRows` |

## Severity priorities

- **P0:** server process cannot start, file access outside allowlist, unbounded parser hang, ZIP decompression exceeding configured cap.
- **P1:** parser child process crash, memory pressure, corrupted/unsupported document, incomplete extraction.
- **P2:** layout loss, formula without cached value, search cap reached, output truncation.

## Operational rule

Do not disable security limits to make a problematic file pass. First reproduce with a copy, identify format/size/encoding, and reduce the input scope. If a control must be raised, record the reason and run the full verification suite again.
