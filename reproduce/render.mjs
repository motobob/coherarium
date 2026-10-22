// SPDX-License-Identifier: Apache-2.0
// Renders six clips (GIF + MP4) from bodies.json using Quinelings by Charles Hoskinson.
// Needs: Node 18+ and ffmpeg. No npm packages. Usage: node render.mjs [outDir]
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(here, 'out'));
const CACHE = path.join(here, '.cache');
const COMMIT = '14689beb83e4f3172ecd51bb70b1c89e78c73011';
const FILES = {
  'lifeform-families.js': '2603d71a9a8d931d881aa7062d35a64d4432fdf9',
  'woven-body.js': 'f5166471e81571becd7c9f76eba1c81a22fcb832',
};

// Git blob id, so the fetched file can be checked against the pinned upstream commit.
const blobId = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

async function fetchUpstream() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [name, want] of Object.entries(FILES)) {
    const file = path.join(CACHE, name);
    if (fs.existsSync(file) && blobId(fs.readFileSync(file)) === want) continue;
    const url = `https://raw.githubusercontent.com/CharlesHoskinson/quinelings/${COMMIT}/${name}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (blobId(buf) !== want) throw new Error(`${name}: blob id mismatch, not the pinned upstream file`);
    fs.writeFileSync(file, buf);
  }
}

await fetchUpstream();
const WB = createRequire(import.meta.url)(path.join(CACHE, 'woven-body.js'));
const spec = JSON.parse(fs.readFileSync(path.join(here, 'bodies.json'), 'utf8'));

// Six clips: [file name, body, start second in the animation].
// Rejected: two bodies, one of them twice at different moments. Accepted: three bodies.
const CLIPS = [
  ['rejected-1', 'a', 0.8], ['rejected-2', 'b', 0.8], ['rejected-3', 'a', 7.8],
  ['accepted-1', 'c', 0.8], ['accepted-2', 'd', 0.8], ['accepted-3', 'e', 0.8],
];
const SECONDS = 10, SIZE = 1080, BG = [7, 11, 20];

function measure(points) {
  const n = points.length / 4, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const x = points[4 * i + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x;
  }
  const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  let half = 1e-6;
  for (let i = 0; i < n; i++) {
    half = Math.max(half, Math.hypot(points[4 * i] - c[0], points[4 * i + 2] - c[2]), Math.abs(points[4 * i + 1] - c[1]));
  }
  return { c, half };
}

function makeRenderer(key) {
  const { graph, record, colour, execution } = spec.bodies[key];
  WB.validate(record, graph);
  const body = WB.compile(record, graph);
  const opts = { budget: 6000, crests: false, execution };
  const view = measure(WB.frame(body, 0, opts).points);
  const col = colour, W = SIZE, H = SIZE;
  const buf = Buffer.alloc(W * H * 4);
  return (seconds) => {
    const res = WB.frame(body, seconds * 0.5, opts);
    for (let i = 0; i < W * H; i++) { buf[4 * i] = BG[0]; buf[4 * i + 1] = BG[1]; buf[4 * i + 2] = BG[2]; buf[4 * i + 3] = 255; }
    const yaw = seconds * 0.35, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const scale = Math.min(W, H) * 0.44 / view.half, p = res.points, n = res.owners.length;
    for (let i = 0; i < n; i++) {
      const x = p[4 * i] - view.c[0], y = p[4 * i + 1] - view.c[1], z = p[4 * i + 2] - view.c[2];
      const xr = x * cs + z * sn, zr = -x * sn + z * cs;
      const depth = Math.max(0.35, Math.min(1.2, 0.8 + 0.4 * zr / view.half));
      const px = Math.round(W / 2 + xr * scale), py = Math.round(H / 2 - y * scale);
      if (px < 0 || py < 0 || px >= W - 1 || py >= H - 1) continue;
      const k = (0.55 + p[4 * i + 3] * 8) * depth;
      for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
        const j = 4 * ((py + oy) * W + px + ox);
        buf[j] = Math.min(255, buf[j] + col[0] * k);
        buf[j + 1] = Math.min(255, buf[j + 1] + col[1] * k);
        buf[j + 2] = Math.min(255, buf[j + 2] + col[2] * k);
      }
    }
    return buf;
  };
}

function encode(outFile, fps, filter, outArgs, frameAt) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${SIZE}x${SIZE}`, '-r', String(fps), '-i', '-',
      '-vf', filter, ...outArgs, outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
    const total = SECONDS * fps;
    let i = 0;
    const pump = () => {
      while (i < total) {
        const ok = ff.stdin.write(Buffer.from(frameAt(i / fps)));
        i++;
        if (!ok) { ff.stdin.once('drain', pump); return; }
      }
      ff.stdin.end();
    };
    pump();
  });
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, key, start] of CLIPS) {
  const render = makeRenderer(key);
  const at = (t) => render(start + t);
  await encode(path.join(OUT, `${name}.mp4`), 25, 'format=yuv420p',
    ['-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-maxrate', '3500k', '-bufsize', '7000k', '-x264-params', 'threads=1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-movflags', '+faststart', '-an'], at);
  await encode(path.join(OUT, `${name}.gif`), 12,
    'scale=540:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
    ['-loop', '0'], at);
  console.log('wrote', name);
}
