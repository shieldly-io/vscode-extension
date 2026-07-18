// @ts-check
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');
const { version: EXT_VERSION } = require('../package.json');

// Non-browser demo proxy (ADR-016). Keyless analysis routes here; the website
// function injects the trusted-proxy secret server-side. IAM Advisor only.
const DEMO_BASE = process.env.SHIELDLY_WEB_URL || 'https://www.shieldly.io';

/**
 * Minimal HTTP client — no external dependencies.
 * @param {string} method
 * @param {string} url
 * @param {object|null} body
 * @param {Record<string,string>} headers
 * @returns {Promise<{status: number, data: any}>}
 */
function request(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `Shieldly-VSCode/${EXT_VERSION}`,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    };
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(opts, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        resolve({ status: res.statusCode ?? 0, data });
      });
    });
    req.on('error', reject);
    // Never hang the editor on a dead connection.
    req.setTimeout(60_000, () => {
      req.destroy(new Error('Request timed out'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Poll job-status until complete or failed. Backoff: 2s→3s→5s…
 * @param {string} jobId
 * @param {string|undefined} apiKey
 * @param {string} apiUrl
 */
async function pollJob(jobId, apiKey, apiUrl) {
  const delays = [2000, 3000, 5000];
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  // Tolerate transient poll failures — one 502/network blip must not abandon
  // a job the worker is still running.
  let consecutiveErrors = 0;
  for (let i = 0; i < 180; i++) {
    const delay = delays[Math.min(i, delays.length - 1)];
    await new Promise((r) => setTimeout(r, delay));
    let status, data;
    try {
      ({ status, data } = await request(
        'GET',
        `${apiUrl}/v1/jobs/${encodeURIComponent(jobId)}`,
        null,
        headers
      ));
    } catch {
      if (++consecutiveErrors >= 3) throw new Error('Lost connection while waiting for analysis');
      continue;
    }
    if (status !== 200) {
      if (++consecutiveErrors >= 3) throw new Error(`Job poll error ${status}`);
      continue;
    }
    consecutiveErrors = 0;
    if (data.status === 'complete') return data.result;
    if (data.status === 'failed') throw new Error(data.error || 'Analysis failed on server');
  }
  throw new Error('Analysis timed out waiting for result');
}

/**
 * Call the Shieldly analyze/iam endpoint.
 * @param {{ policy: string, policyType?: string, apiKey?: string, apiUrl: string }} opts
 * @returns {Promise<{success: boolean, result?: object, limitReached?: boolean, error?: string}>}
 */
async function analyzeIAM({ policy, policyType = 'iam_identity', apiKey, apiUrl }) {
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // Route to the correct endpoint and body format:
  //   - No apiKey: demo proxy (returns sync 200; accepts both IAM and CF via policyType)
  //   - CF with apiKey: /v1/analyze/cf with { template }
  //   - IAM with apiKey: /v1/analyze/iam with { policy, policyType }
  let endpoint, body;
  if (!apiKey) {
    endpoint = `${DEMO_BASE}/api/demo/analyze-iam`;
    body = policyType === 'cf' ? { template: policy, policyType } : { policy, policyType };
  } else if (policyType === 'cf') {
    endpoint = `${apiUrl}/v1/analyze/cf`;
    body = { template: policy };
  } else {
    endpoint = `${apiUrl}/v1/analyze/iam`;
    body = { policy, policyType };
  }

  try {
    const { status: postStatus, data: postData } = await request('POST', endpoint, body, headers);

    if (postStatus === 202 && postData?.jobId) {
      const result = await pollJob(postData.jobId, apiKey, apiUrl);
      return { success: true, result };
    }
    if (postStatus === 429) {
      return {
        success: false,
        limitReached: true,
        error: postData?.error || 'Daily limit reached',
      };
    }
    if (postStatus === 401 || postStatus === 403) {
      return { success: false, error: postData?.error || 'Unauthorized. Check your API key.' };
    }
    if (postStatus !== 200) {
      return { success: false, error: postData?.error || `API error ${postStatus}` };
    }
    return { success: true, result: postData };
  } catch (err) {
    return { success: false, error: err.message || 'Network error' };
  }
}

module.exports = { analyzeIAM };
