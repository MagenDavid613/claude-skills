#!/usr/bin/env node
/**
 * scrollcraft asset generator: Magnific API (nano-banana-pro-flash + kling-v2-1-master).
 *
 * Same CLI shape as kie.mjs, so nothing else in the skill has to change:
 *
 *   still  <prompt> <out.png> [--ar 16:9] [--ref a.png]
 *          POST /v1/ai/text-to-image/nano-banana-pro-flash
 *          Reference images make it image-to-image (max 14 refs).
 *
 *   shot   <prompt> <head.png> <out.mp4> [--tail b.png] [--dur 5]
 *          POST /v1/ai/image-to-video/kling-v2-1-master
 *          --tail is accepted for CLI parity with kie.mjs but Magnific's
 *          Kling 2.1 Master endpoint takes a single `image` field, not a
 *          head/tail pair. If you actually need tail-pinned chaining
 *          (leg N's last frame = leg N+1's first, for a seamless cut), check
 *          Kling O1 on Magnific instead, which is a distinct endpoint.
 *
 *   probe  sanity-check the API key against Magnific.
 *
 * Docs: https://docs.magnific.com/api-reference
 * Auth: header `x-magnific-api-key`, read from MAGNIFIC_API_KEY in the
 *       project-root .env if not already set in the environment.
 *
 * One real difference from kie.ai: Magnific's endpoints are documented to
 * take a public URL for reference/input images rather than raw base64 (the
 * video endpoint's `image` field is looser and does accept base64 or a URL).
 * There is no documented Magnific upload endpoint, so a local file for
 * `still --ref` is sent as a data: URI; if Magnific rejects that for a given
 * account/model, host the file yourself first and pass its https URL instead.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = "https://api.magnific.com";

const ENDPOINTS = {
  still: "/v1/ai/text-to-image/nano-banana-pro-flash",
  shot:  "/v1/ai/image-to-video/kling-v2-1-master",
};

// ---------------------------------------------------------------- key ----
// Checks, in order: cwd walking up to the filesystem root (so a build
// project's own .env wins), then the skill's own directory (..HERE/..), since
// that is where the install instructions put .env when there is no separate
// build project yet.
function findEnv(varName) {
  const tryDir = (start) => {
    let dir = path.resolve(start);
    for (;;) {
      const p = path.join(dir, ".env");
      if (fs.existsSync(p) && new RegExp(`^\\s*${varName}\\s*=\\s*\\S+`, "m").test(fs.readFileSync(p, "utf8"))) return p;
      const up = path.dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  };
  return tryDir(process.cwd()) || tryDir(path.join(HERE, "..")) || null;
}
function loadKey() {
  if (process.env.MAGNIFIC_API_KEY) return process.env.MAGNIFIC_API_KEY;
  const envPath = findEnv("MAGNIFIC_API_KEY");
  if (!envPath) throw new Error("MAGNIFIC_API_KEY not set, and no .env holding it found walking up from " + process.cwd() + " or in the skill directory");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*MAGNIFIC_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("MAGNIFIC_API_KEY not found in " + envPath);
}
const KEY = loadKey();
const H = { "Content-Type": "application/json", "x-magnific-api-key": KEY };

// ------------------------------------------------------------- helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toDataUrl(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error("input not found: " + abs);
  const ext = path.extname(abs).slice(1).toLowerCase();
  const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  return { dataUrl: `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`, mime };
}

// A local path becomes a data: URI; an http(s) string passes straight through.
const asImage = (v) => (/^https?:\/\//i.test(v) ? v : toDataUrl(v).dataUrl);

async function createTask(endpoint, input) {
  const res = await fetch(`${API}${endpoint}`, {
    method: "POST", headers: H, body: JSON.stringify(input),
  });
  const j = await res.json();
  const taskId = j?.data?.task_id;
  if (!res.ok || !taskId) throw new Error(`createTask ${endpoint}: ${res.status} ${JSON.stringify(j)}`);
  return taskId;
}

async function waitTask(endpoint, taskId, { label = "job", timeoutMs = 15 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  let delay = 4000;
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: timed out after ${Math.round((Date.now() - t0) / 1000)}s`);
    const res = await fetch(`${API}${endpoint}/${encodeURIComponent(taskId)}`, { headers: H });
    const j = await res.json();
    const d = j?.data || {};
    const state = d.status;
    if (state === "COMPLETED") {
      const urls = d.generated || [];
      if (!urls.length) throw new Error(`${label}: completed with no result url: ${JSON.stringify(d)}`);
      return urls;
    }
    if (state === "FAILED") {
      throw new Error(`${label} failed: ${d.error || JSON.stringify(d)}`);
    }
    process.stderr.write(`  ${label}: ${state || "unknown"} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
    await sleep(delay);
    delay = Math.min(delay * 1.25, 15000);
  }
}

async function download(url, out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  fs.writeFileSync(path.resolve(out), Buffer.from(await res.arrayBuffer()));
  return out;
}

function flag(argv, name, dflt = null) {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : dflt;
}
function flags(argv, name) {
  const out = [];
  argv.forEach((a, i) => { if (a === name && argv[i + 1]) out.push(argv[i + 1]); });
  return out;
}

// ---------------------------------------------------------------- main ----
const [cmd, ...rest] = process.argv.slice(2);

try {
  if (cmd === "probe") {
    // No documented credit-balance endpoint. Confirm the key is live with a
    // cheap-as-possible authenticated call, and point at the real dashboard
    // for the actual balance.
    const res = await fetch(`${API}${ENDPOINTS.still}/00000000-0000-0000-0000-000000000000`, { headers: H });
    if (res.status === 401) throw new Error("key rejected (401) — check MAGNIFIC_API_KEY");
    console.log(`key accepted (HTTP ${res.status} on a dummy task id, which is expected).`);
    console.log("check balance at: https://www.magnific.com/developers/dashboard");

  } else if (cmd === "still") {
    const [prompt, out] = rest;
    if (!prompt || !out) throw new Error('usage: magnific.mjs still "<prompt>" <out.png> [--ar 16:9] [--ref a.png]');
    const ar = flag(rest, "--ar", "16:9");
    const refs = flags(rest, "--ref");
    const input = {
      prompt,
      aspect_ratio: ar,
      resolution: flag(rest, "--resolution", "2K"),
    };
    if (refs.length) {
      input.reference_images = refs.map((r) => ({
        image: asImage(r),
        mime_type: /^https?:\/\//i.test(r) ? "image/png" : toDataUrl(r).mime,
      }));
    }
    const id = await createTask(ENDPOINTS.still, input);
    const urls = await waitTask(ENDPOINTS.still, id, { label: path.basename(out) });
    await download(urls[0], out);
    console.log(out);

  } else if (cmd === "shot") {
    const [prompt, head, out] = rest;
    if (!prompt || !head || !out) {
      throw new Error('usage: magnific.mjs shot "<prompt>" <head.png> <out.mp4> [--tail b.png] [--dur 5]');
    }
    if (flag(rest, "--tail")) {
      console.error("note: kling-v2-1-master takes one input image, not a head/tail pair — ignoring --tail. Use Kling O1 on Magnific for pinned first/last frame chaining.");
    }
    const dur = flag(rest, "--dur", "5");
    const input = {
      image: asImage(head),
      prompt,
      negative_prompt: "blur, distortion, low quality, warping, morphing, jitter, flicker, text, watermark, cut, scene change",
      duration: String(dur) === "10" ? "10" : "5",
      cfg_scale: 0.5,
    };
    const id = await createTask(ENDPOINTS.shot, input);
    const urls = await waitTask(ENDPOINTS.shot, id, { label: path.basename(out), timeoutMs: 20 * 60 * 1000 });
    await download(urls[0], out);
    console.log(out);

  } else {
    console.error(`scrollcraft asset generator (Magnific)

  node magnific.mjs probe
  node magnific.mjs still "<prompt>" <out.png> [--ar 16:9] [--resolution 2K] [--ref ref.png]
  node magnific.mjs shot  "<prompt>" <head.png> <out.mp4> [--dur 5|10]
`);
    process.exit(1);
  }
} catch (err) {
  console.error("ERROR:", err.message);
  process.exit(1);
}
