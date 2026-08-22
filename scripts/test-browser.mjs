import { readFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "acorn";
import { chromium } from "playwright";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browserEntry = resolve(projectRoot, "dist/browser.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function moduleSpecifiers(source, path) {
  const root = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const specifiers = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === null || typeof node !== "object") continue;
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportAllDeclaration" ||
        node.type === "ExportNamedDeclaration") &&
      typeof node.source?.value === "string"
    ) {
      specifiers.push(node.source.value);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "start" || key === "end" || key === "loc") continue;
      if (Array.isArray(value)) pending.push(...value);
      else if (value !== null && typeof value === "object") pending.push(value);
    }
  }
  for (const specifier of specifiers) {
    assert(!specifier.startsWith("node:"), path + " imports " + specifier);
    assert(specifier !== "skia-canvas", path + " imports skia-canvas");
  }
  return specifiers;
}

async function verifyBrowserGraph(entry) {
  const pending = [entry];
  const visited = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || visited.has(path)) continue;
    visited.add(path);
    const source = await readFile(path, "utf8");
    assert(!source.includes("skia-canvas"), path + " contains skia-canvas");
    assert(!source.includes('from "node:'), path + " contains a Node import");
    for (const specifier of moduleSpecifiers(source, path)) {
      if (specifier.startsWith(".")) {
        pending.push(resolve(dirname(path), specifier));
      } else {
        assert(
          specifier === "pts",
          path + " has unexpected bare import " + specifier,
        );
      }
    }
  }
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

async function startServer() {
  const canonicalRoot = await realpath(projectRoot);
  const canonicalPtsRoot = await realpath(
    resolve(projectRoot, "node_modules/pts"),
  );
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const pathname = decodeURIComponent(
          new URL(request.url ?? "/", "http://localhost").pathname,
        );
        const requested = resolve(projectRoot, "." + pathname);
        const canonical = await realpath(requested);
        const inProject =
          canonical === canonicalRoot ||
          canonical.startsWith(canonicalRoot + sep);
        const inInstalledPts =
          pathname.startsWith("/node_modules/pts/") &&
          (canonical === canonicalPtsRoot ||
            canonical.startsWith(canonicalPtsRoot + sep));
        if (!inProject && !inInstalledPts) {
          response.writeHead(403).end("Forbidden");
          return;
        }
        const body = await readFile(canonical);
        response.writeHead(200, { "content-type": contentType(canonical) });
        response.end(body);
      } catch {
        response.writeHead(404).end("Not found");
      }
    })();
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Browser smoke server did not bind a TCP port");
  }
  return {
    server,
    url:
      "http://127.0.0.1:" + String(address.port) + "/test/browser/smoke.html",
  };
}

await verifyBrowserGraph(browserEntry);
const { server, url } = await startServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .locator('body[data-status="passed"], body[data-status="failed"]')
    .waitFor();
  const status = await page.locator("body").getAttribute("data-status");
  const result = await page.locator("#result").textContent();
  assert(
    status === "passed" && result === "browser smoke passed",
    "Browser smoke failed: " + result,
  );
  assert(failures.length === 0, "Browser errors: " + failures.join("; "));
} finally {
  await browser.close();
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
}

process.stdout.write("Browser scene mount and dependency graph passed\n");
