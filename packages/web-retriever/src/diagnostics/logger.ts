/**
 * diagnostics/logger.ts
 *
 * Structured logger — off by default, zero remote calls, zero telemetry.
 *
 * §66 and §86 of the spec.
 *
 * The logger writes structured JSON lines to stderr when enabled.
 * It is never enabled by default — the host application must explicitly
 * opt in via the RETRIEVER_LOG_LEVEL environment variable or by calling
 * setLogLevel().
 *
 * Log levels: "debug" | "info" | "warn" | "error" | "off" (default)
 *
 * No remote logging, no analytics, no telemetry.  §66 is an explicit
 * non-negotiable constraint.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "off";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let currentLevel: LogLevel = "off";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  off: 99,
};

// Honour the environment variable at import time so it works in all runtimes.
const envLevel = (process.env["RETRIEVER_LOG_LEVEL"] ?? "off").toLowerCase() as LogLevel;
if (envLevel in LEVEL_ORDER) {
  currentLevel = envLevel;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Programmatically set the log level (overrides the env variable). */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function debug(message: string, data?: Record<string, unknown>): void {
  log("debug", message, data);
}

export function info(message: string, data?: Record<string, unknown>): void {
  log("info", message, data);
}

export function warn(message: string, data?: Record<string, unknown>): void {
  log("warn", message, data);
}

export function error(message: string, data?: Record<string, unknown>): void {
  log("error", message, data);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };

  if (data) {
    Object.assign(entry, data);
  }

  // Write to stderr — never stdout (stdout is reserved for MCP protocol output).
  process.stderr.write(JSON.stringify(entry) + "\n");
}
