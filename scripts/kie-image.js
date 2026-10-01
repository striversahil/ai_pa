// kie-image.js — GPT Image 2.5 (Flare, text-to-image) via kie.ai, async polling.
// Model: gpt-image-2-5-flare-text-to-image (pure text input — no source
// image needed; the flare IMAGE-TO-IMAGE sibling requires input_urls and
// is for restyling existing photos, a different mode).
// kieImage(prompt) → base64 PNG (no data-URI prefix), same shape as
// agnesImage() in runner-lib.js so callers can swap. Key via KIE_API_KEY.

'use strict';

const API = 'https://api.kie.ai';
const MODEL = 'gpt-image-2-5-flare-text-to-image';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function kieImage(prompt, { aspectRatio = '1:1', resolution = '1K' } = {}) {
  const key = process.env.KIE_API_KEY;
  if (!key) throw new Error('KIE_API_KEY not set');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const create = await fetch(`${API}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MODEL,
      input: { prompt, aspect_ratio: aspectRatio, resolution, background: 'opaque' },
    }),
  }).then((r) => r.json());
  if (create.code !== 200 || !create.data?.taskId) {
    throw new Error(`kie create failed: ${create.code} ${create.msg}`);
  }
  const taskId = create.data.taskId;
  const t0 = Date.now();
  for (;;) {
    await sleep(8000);
    const q = await fetch(`${API}/api/v1/jobs/recordInfo?taskId=${taskId}`, { headers })
      .then((r) => r.json());
    const st = q.data?.state;
    if (st === 'success') {
      const urls = JSON.parse(q.data.resultJson).resultUrls;
      if (!urls?.length) throw new Error('kie success but no resultUrls');
      const buf = Buffer.from(await (await fetch(urls[0])).arrayBuffer());
      if (buf.length < 10000) throw new Error(`kie image suspiciously small (${buf.length}B)`);
      return buf.toString('base64');
    }
    if (st === 'fail') throw new Error(`kie task failed: ${q.data.failCode} ${q.data.failMsg}`);
    if (Date.now() - t0 > 10 * 60 * 1000) throw new Error('kie poll timeout (10 min)');
  }
}

module.exports = { kieImage };
