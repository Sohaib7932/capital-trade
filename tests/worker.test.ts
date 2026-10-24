import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WORKER_DIR = path.join(process.cwd(), "mt5-worker");
const PYTHON = path.join(WORKER_DIR, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** The MT5 worker's own Python tests (fake MT5 terminal and API): shared-terminal refusal, failing accounts, … */
describe("MT5 worker (Python)", () => {
  it.skipIf(!existsSync(PYTHON))("passes its unit tests", () => {
    const run = spawnSync(PYTHON, ["-m", "unittest", "discover", "-s", "tests"], { cwd: WORKER_DIR, encoding: "utf8" });
    const summary = run.stderr.split("\n").filter((l) => /^(Ran |OK|FAILED)/.test(l));
    expect(summary.join(" "), run.stderr.slice(-3000)).toMatch(/OK/);
    expect(run.status).toBe(0);
  }, 120_000);
});
