// Minimal Claude client for Fieldwork's paid features. Uses the Messages API
// directly (no SDK), asks for JSON, and reports what each call cost.

export const MODELS = {
  writer: 'claude-sonnet-5-5', // briefings and emails: quality matters
  helper: 'claude-haiku-5-5', // extraction and sorting: cheap and fast
};

// USD per million tokens (input, output). Haiku's price is for prompts up to 100K tokens,
// which is all Fieldwork ever sends. Keep in sync with https://platform.claude.com/docs/en/about-claude/pricing
const PRICES = {
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

export class AiError extends Error {
  constructor(message, status = 502, code = 'ai_failed') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function costOf(model, usage = {}) {
  const [inp, out] = PRICES[model] || [0, 0];
  const read = usage.cache_read_input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  return ((usage.input_tokens || 0) * inp + write * inp * 1.25 + read * inp * 0.1 + (usage.output_tokens || 0) * out) / 1e6;
}

/** Pull the first JSON object out of model text (tolerates code fences). */
export function parseJsonObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiError('The AI reply had no JSON.');
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new AiError('The AI reply was not valid JSON.');
  }
}

export function createAi({ apiKey, fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  const enabled = !!apiKey;

  async function call({ model, system, user, maxTokens = 1500 }) {
    if (!enabled) throw new AiError('AI features are not set up yet.', 503, 'ai_not_configured');
    let res;
    try {
      res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AiError('The AI service did not respond. Try again.');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('AI call failed', res.status, detail.slice(0, 300));
      if (res.status === 401 || res.status === 403)
        throw new AiError('The AI key needs attention. Ask the site owner to check it.', 503, 'ai_auth');
      if (res.status === 429 || res.status === 529)
        throw new AiError('The AI service is busy. Try again in a minute.', 503, 'ai_busy');
      throw new AiError('The AI service had a problem. Try again.');
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, usage: data.usage || {}, cost: costOf(model, data.usage), model };
  }

  /** Ask for a JSON object; retries once if the reply isn't parseable. */
  async function json(opts) {
    let spent = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await call(opts);
      spent += r.cost;
      try {
        return { value: parseJsonObject(r.text), cost: spent };
      } catch (e) {
        if (attempt === 1) throw e;
      }
    }
  }

  return { enabled, call, json };
}
