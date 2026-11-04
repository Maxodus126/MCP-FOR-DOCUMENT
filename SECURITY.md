# Security model and residual risks

## Trust boundary

The MCP process is a local STDIO service. It has the filesystem permissions of the OS account that launches it. `ALLOWED_DIRS` is an application-level allowlist, not an OS sandbox.

## Controls implemented

- Absolute path requirement and canonical path allowlist.
- Regular-file check, file size cap (hard maximum 50 MB), stat snapshot and revalidation.
- `O_NOFOLLOW` and `O_NONBLOCK` where the host OS exposes them.
- File signature checks before parser dispatch.
- Parser execution in a per-job child process with V8 heap limits, timeout, cancellation, bounded concurrency/queue, and bounded queue wait time.
- Office ZIP central/local directory checks, actual decompression cap, actual compression ratio, CRC32, entry count, duplicate names, traversal names and Unix symlink entry rejection.
- No writes to source documents; no external network fetch; no shell execution from document content.
- Structured logs to STDERR; document body and full file path are not logged.
- Tool errors are sanitized and do not expose stack traces.

## Residual risks

1. Parser berjalan dalam child process Node terpisah sehingga native parser crash lebih terisolasi dari gateway. V8 heap flags bukan hard cap untuk RSS/native memory atau CPU; gunakan container/OS quota untuk hard limit.
2. Node path APIs cannot completely eliminate races involving replacement of parent directories, hardlinks, mount points, or unusual Windows reparse points.
3. ExcelJS loads a workbook into memory. ZIP expansion is capped, but object overhead may exceed the uncompressed XML size.
4. PDF text extraction requests only selected pages through the parser partial-page option, but the parser may still load shared PDF structures; this is not a guarantee of page-only disk I/O.
5. Parser dependencies can contain vulnerabilities; review `npm audit` output and update dependencies only with regression tests.
6. A document can contain prompt injection. Tool output is untrusted content and must not override system/developer instructions.

## Deployment recommendations for hostile documents

- Use a dedicated low-privilege OS account.
- Mount allowed input folders read-only.
- Run in a container/VM with memory, CPU, PID and filesystem quotas.
- Keep allowed roots narrow and avoid folders containing credentials or application secrets.
- Keep concurrency at 1 until load tests demonstrate headroom.
- Do not expose the STDIO server through an unauthenticated network bridge.
