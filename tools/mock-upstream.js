// Preload for the cooldown self-check (node --require tools/mock-upstream.js server.js).
// Fakes the two public upstreams so the 429 path can be measured without
// burning anyone's quota:
//   - OVH public endpoint  -> 429 + a 38-day `retry-after` (what it really sends)
//   - Pollinations         -> a one-line SSE answer
// Every hit is appended to MOCK_LOG so the test can count the attempts.
const fs = require('fs');
const LOG = process.env.MOCK_LOG || '/tmp/mock-upstream.log';
const origFetch = globalThis.fetch;

globalThis.fetch = async function (url, opts) {
  const u = String(url && url.url ? url.url : url);
  if (/ovh\.endpoints|kepler\.ai\.cloud\.ovh\.net/.test(u)) {
    fs.appendFileSync(LOG, 'ovh\n');
    return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '3317393' }
    });
  }
  if (/pollinations/.test(u)) {
    fs.appendFileSync(LOG, 'pollinations\n');
    const sse = 'data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n';
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  return origFetch.apply(this, arguments);
};
