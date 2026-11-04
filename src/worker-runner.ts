import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AppError } from "./errors.js";
import type { AppConfig } from "./config.js";

export type CellValue = string | number | boolean | null;
export type RowValues = CellValue[];

export type ParserJob =
  | { kind: "pdf-info" }
  | { kind: "pdf-read"; startPage: number; endPage?: number; maxChars: number }
  | { kind: "pdf-search"; query: string; maxResults: number }
  | { kind: "word-read"; maxChars: number }
  | { kind: "word-search"; query: string; maxResults: number }
  | { kind: "excel-read"; extension: ".xlsx" | ".csv"; sheetName?: string; maxRows: number; maxColumns: number; outputFormat: "markdown" | "json" }
  | { kind: "excel-search"; extension: ".xlsx" | ".csv"; query: string; maxResults: number }
  | { kind: "pdf-create"; text: string; destPath: string; maxBytes: number }
  | { kind: "docx-create"; markdown: string; destPath: string; maxBytes: number }
  | { kind: "excel-create"; extension: ".xlsx" | ".csv"; sheetName: string; headers: string[]; rows: RowValues[]; destPath: string; maxBytes: number }
  | { kind: "convert"; sourceExtension: string; targetFormat: "pdf" | "docx" | "xlsx" | "csv"; sheetName?: string; destPath: string; maxBytes: number };

interface WorkerResponse<T> { ok: true; result: T }
interface WorkerFailure { ok: false; error: { code: string; message: string } }

const activeChildren = new Set<ChildProcess>();

export async function terminateAllWorkers(): Promise<void> {
  const children = [...activeChildren];
  await Promise.all(children.map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill();
  })));
}

export async function runParserWorker<T>(
  buffer: Buffer,
  job: ParserJob,
  config: AppConfig,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new AppError("REQUEST_CANCELLED", "Permintaan dibatalkan sebelum parser dijalankan.");

  const isTypeScript = import.meta.url.endsWith(".ts");
  const childPath = fileURLToPath(new URL(isTypeScript ? "./parser-child.ts" : "./parser-child.js", import.meta.url));
  const execArgv = [
    `--max-old-space-size=${config.workerOldSpaceMb}`,
    `--max-semi-space-size=${config.workerSemiSpaceMb}`,
    ...(isTypeScript ? ["--import", new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).href] : []),
  ];

  let child: ChildProcess;
  try {
    child = fork(childPath, [], {
      cwd: process.cwd(),
      env: process.env,
      execArgv,
      serialization: "advanced",
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
  } catch {
    throw new AppError("WORKER_START_FAILED", "Parser process gagal dijalankan. Periksa instalasi Node.js dan dependency.");
  }
  activeChildren.add(child);

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (signal) signal.removeEventListener("abort", onAbort);
      activeChildren.delete(child);
    };
    const killChild = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, 750);
        forceKillTimer.unref?.();
      }
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      killChild();
      reject(error);
    };
    const succeed = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { child.disconnect(); } catch { /* IPC may already be closed */ }
      killChild();
      resolve(value);
    };
    const onAbort = () => fail(new AppError("REQUEST_CANCELLED", "Permintaan dibatalkan oleh MCP client; parser process dihentikan."));

    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      fail(new AppError("PROCESSING_TIMEOUT", `Pemrosesan melewati batas ${config.maxProcessingTimeoutMs} ms. Coba dokumen atau rentang yang lebih kecil.`));
    }, config.maxProcessingTimeoutMs);
    timer.unref?.();

    child.once("message", (message: WorkerResponse<T> | WorkerFailure) => {
      if (message && message.ok === true) succeed(message.result);
      else if (message && message.ok === false) {
        fail(new AppError(message.error?.code ?? "PARSER_FAILED", message.error?.message ?? "Parser process gagal memproses dokumen."));
      } else fail(new AppError("WORKER_PROTOCOL_ERROR", "Parser process mengirim respons yang tidak valid."));
    });
    child.once("error", () => fail(new AppError("WORKER_START_FAILED", "Parser process gagal dimulai atau kanal IPC terputus.")));
    child.once("exit", (code, signalName) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (!settled) {
        const detail = signalName ? `signal ${signalName}` : `exit code ${code}`;
        fail(new AppError("WORKER_CRASHED", `Parser process berhenti sebelum menyelesaikan tugas (${detail}). Periksa ukuran file dan batas memori.`));
      }
    });

    try {
      child.send({ job, config, bytes: buffer }, (error) => {
        if (error) fail(new AppError("WORKER_IPC_FAILED", "Data dokumen gagal dikirim ke parser process."));
      });
    } catch {
      fail(new AppError("WORKER_IPC_FAILED", "Data dokumen gagal dikirim ke parser process."));
    }
  });
}
