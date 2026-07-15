#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WIDTH = 1080;
const HEIGHT = 1350;
const FPS = 30;
const DURATION_MS = 46_200;
const TOTAL_FRAMES = Math.round((DURATION_MS / 1000) * FPS);
const DEBUG_PORT = 9228;
const ROOT = path.resolve(__dirname, "..");
const SHOWCASE = path.join(ROOT, "docs", "showcase.html");
const OUTPUT = path.resolve(process.argv[2] || path.join(__dirname, "bibtex-verifier-linkedin.mp4"));
const CHROME = process.env.CHROME_BIN || "/usr/bin/google-chrome";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const frameName = (directory, index) => path.join(directory, `frame-${String(index).padStart(6, "0")}.jpg`);

async function waitForDebugger() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome may still be starting.
    }
    await wait(100);
  }
  throw new Error("Chrome did not expose a debugging target.");
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let requestId = 0;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }

    const handlers = listeners.get(message.method) || [];
    handlers.forEach((handler) => handler(message.params));
  });

  return {
    ready,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, handler) {
      const handlers = listeners.get(method) || [];
      handlers.push(handler);
      listeners.set(method, handlers);
    },
    close() {
      socket.close();
    },
  };
}

function runFfmpeg(frameDirectory) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    const availableEncoders = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
    const encoderList = `${availableEncoders.stdout || ""}${availableEncoders.stderr || ""}`;
    let encoderArgs;
    if (/\blibx264\b/.test(encoderList)) {
      encoderArgs = ["-c:v", "libx264", "-preset", "slow", "-crf", "18"];
    } else if (/\blibopenh264\b/.test(encoderList)) {
      encoderArgs = ["-c:v", "libopenh264", "-b:v", "8M", "-maxrate", "10M", "-bufsize", "16M"];
    } else {
      encoderArgs = ["-c:v", "mpeg4", "-q:v", "2"];
    }

    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel", "warning",
      "-framerate", String(FPS),
      "-i", path.join(frameDirectory, "frame-%06d.jpg"),
      "-an",
      ...encoderArgs,
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-metadata", "title=BibTeX Verifier — Product Showcase",
      OUTPUT,
    ], { stdio: ["ignore", "inherit", "inherit"] });

    ffmpeg.once("error", reject);
    ffmpeg.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
  if (!fs.existsSync(SHOWCASE)) throw new Error(`Showcase not found at ${SHOWCASE}`);

  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bibtex-showcase-"));
  const profileDirectory = path.join(workingDirectory, "chrome-profile");
  const frameDirectory = path.join(workingDirectory, "frames");
  fs.mkdirSync(frameDirectory);

  const showcaseUrl = `file://${SHOWCASE}?autoplay=0&controls=0&loop=0`;
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDirectory}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "--force-device-scale-factor=1",
    showcaseUrl,
  ], { stdio: ["ignore", "ignore", "pipe"] });

  let chromeErrors = "";
  chrome.stderr.on("data", (chunk) => {
    chromeErrors += chunk.toString();
  });

  let cdp;
  try {
    const debuggerUrl = await waitForDebugger();
    cdp = createCdpClient(debuggerUrl);
    await cdp.ready;
    await cdp.call("Page.enable");
    await cdp.call("Runtime.enable");
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: WIDTH,
      screenHeight: HEIGHT,
    });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await cdp.call("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      if (state.result.value === "complete") break;
      await wait(50);
    }

    let recording = false;
    let firstTimestamp;
    let nextFrame = 0;
    let previousFramePath;
    let resolveCapture;
    const captureComplete = new Promise((resolve) => {
      resolveCapture = resolve;
    });

    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      cdp.call("Page.screencastFrameAck", { sessionId }).catch(() => {});
      if (!recording) return;

      const timestamp = metadata.timestamp * 1000;
      if (firstTimestamp === undefined) firstTimestamp = timestamp;
      const targetFrame = Math.min(TOTAL_FRAMES - 1, Math.floor(((timestamp - firstTimestamp) / 1000) * FPS));
      const image = Buffer.from(data, "base64");

      if (nextFrame === 0) {
        previousFramePath = frameName(frameDirectory, 0);
        fs.writeFileSync(previousFramePath, image);
        nextFrame = 1;
        return;
      }

      if (targetFrame < nextFrame) return;
      while (nextFrame < targetFrame) {
        fs.linkSync(previousFramePath, frameName(frameDirectory, nextFrame));
        nextFrame += 1;
      }

      previousFramePath = frameName(frameDirectory, nextFrame);
      fs.writeFileSync(previousFramePath, image);
      nextFrame += 1;
      if (nextFrame >= TOTAL_FRAMES) resolveCapture();
    });

    await cdp.call("Page.startScreencast", {
      format: "jpeg",
      quality: 94,
      maxWidth: WIDTH,
      maxHeight: HEIGHT,
      everyNthFrame: 1,
    });
    await wait(250);

    recording = true;
    await cdp.call("Runtime.evaluate", {
      expression: "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))",
    });

    console.log(`Capturing ${WIDTH}×${HEIGHT} at ${FPS} FPS for ${(DURATION_MS / 1000).toFixed(1)} seconds…`);
    await Promise.race([captureComplete, wait(DURATION_MS + 2_000)]);
    recording = false;
    await cdp.call("Page.stopScreencast");

    if (!previousFramePath) throw new Error("Chrome did not produce any video frames.");
    while (nextFrame < TOTAL_FRAMES) {
      fs.linkSync(previousFramePath, frameName(frameDirectory, nextFrame));
      nextFrame += 1;
    }

    console.log(`Encoding ${TOTAL_FRAMES} frames…`);
    await runFfmpeg(frameDirectory);
    const sizeMb = (fs.statSync(OUTPUT).size / (1024 * 1024)).toFixed(1);
    console.log(`Created ${OUTPUT} (${sizeMb} MB)`);
  } catch (error) {
    if (chromeErrors.trim()) console.error(chromeErrors.trim());
    throw error;
  } finally {
    cdp?.close();
    chrome.kill("SIGTERM");
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
