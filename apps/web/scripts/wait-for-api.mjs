// Holds `pnpm dev` for the web app until the API answers /health, so the page you
// open never meets a proxy with nothing behind it ("Bad Gateway"). The API needs
// ~10 s to compile and connect to Postgres; Vite starts in ~1 s.
//
// Never blocks for good: after the time limit it starts Vite anyway, so the web
// app still runs on its own (UI work against mocked fetch, or an API on another port).

const port = process.env.API_PORT || '3000';
const url = `http://localhost:${port}/health`;
const limitMs = Number(process.env.WAIT_FOR_API_MS ?? 60_000);
const started = Date.now();

async function apiIsUp() {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

console.log(`web: waiting for the API at ${url} ...`);
while (!(await apiIsUp())) {
  if (Date.now() - started > limitMs) {
    console.warn(
      `web: no API after ${limitMs / 1000} s; starting anyway (API calls will fail until it runs)`,
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.log(`web: API is up after ${((Date.now() - started) / 1000).toFixed(1)} s`);
