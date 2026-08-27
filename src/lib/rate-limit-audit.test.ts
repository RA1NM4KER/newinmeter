import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const API_ROOT = join(process.cwd(), "src/app/api");
const EXEMPT_ROUTES = new Set([
  "src/app/api/beacon/summary/route.ts",
  "src/app/api/cron/auto-sync/route.ts",
  "src/app/api/cron/livemopay-canary/route.ts",
  "src/app/api/cron/stale-check/route.ts"
]);

function routeFiles(directory = API_ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : [];
  });
}

function publicRoute(path: string) {
  return `/${relative(join(process.cwd(), "src/app"), path).replace(/\/route\.ts$/, "")}`;
}

describe("API rate-limit audit", () => {
  it("keeps every non-internal API route behind the shared limiter", () => {
    const unprotected = routeFiles()
      .map((path) => ({ path: relative(process.cwd(), path), source: readFileSync(path, "utf8") }))
      .filter(({ source }) => !/\b(?:enforceRateLimit|limitUserRequest)\s*\(/.test(source))
      .map(({ path }) => path)
      .sort();

    expect(unprotected).toEqual(Array.from(EXEMPT_ROUTES).sort());
  });

  it("documents every exported API method and every exemption", () => {
    const audit = readFileSync(join(process.cwd(), "docs/api-rate-limit-audit.md"), "utf8");

    for (const path of routeFiles()) {
      const source = readFileSync(path, "utf8");
      const route = publicRoute(path);
      const auditLines = audit.split("\n").filter((line) => line.includes(`| \`${route}\` |`));
      expect(auditLines, `${route} is missing from the audit`).not.toHaveLength(0);

      for (const match of Array.from(source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g))) {
        expect(auditLines.join("\n"), `${match[1]} ${route} is missing from the audit`).toContain(match[1]);
      }
    }

    for (const path of Array.from(EXEMPT_ROUTES)) {
      expect(audit).toContain(`\`${publicRoute(join(process.cwd(), path))}\``);
    }
  });
});
