// Claude client for Fieldwork's paid features. Uses the Messages API directly
// (no SDK): JSON replies for tools, streaming for chat, and the cost of every call.

export const MODELS = {
  best: 'claude-opus-5-5', // briefings, emails, reviews, application builder: quality matters most
  fast: 'claude-sonnet-5-5', // coach chat, interview practice, letter kits: quick back-and-forth
  helper: 'claude-haiku-5-5', // transcribing uploaded files: cheap and fast
};

// USD per million tokens (input, output). Thinking tokens bill as output.
// Keep in sync with https://platform.claude.com/docs/en/about-claude/pricing
const PRICES = {
  'claude-opus-5-5': [4, 20],
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

function httpError(status) {
  if (status === 401 || status === 403)
    return new AiError('The AI key needs attention. Ask the site owner to check it.', 503, 'ai_auth');
  if (status === 429 || status === 529) return new AiError('The AI service is busy. Try again in a minute.', 503, 'ai_busy');
  return new AiError('The AI service had a problem. Try again.');
}

export function createAi({ apiKey, fetchImpl = fetch, timeoutMs = 120000 } = {}) {
  const enabled = !!apiKey;

  function request({ model, system, user, messages, maxTokens = 4000, effort, stream = false }) {
    if (!enabled) throw new AiError('AI features are not set up yet.', 503, 'ai_not_configured');
    const body = {
      model,
      max_tokens: maxTokens,
      system,
      messages: messages || [{ role: 'user', content: user }],
      ...(effort ? { output_config: { effort } } : {}),
      ...(stream ? { stream: true } : {}),
    };
    return fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => {
      throw new AiError('The AI service did not respond. Try again.');
    });
  }

  async function call(opts) {
    const res = await request(opts);
    if (!res.ok) {
      console.warn('AI call failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
      throw httpError(res.status);
    }
    const data = await res.json();
    // Thinking blocks come first; only text blocks are the answer.
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, usage: data.usage || {}, cost: costOf(opts.model, data.usage), model: opts.model, stop: data.stop_reason };
  }

  /** Ask for a JSON object; retries once if the reply isn't parseable. */
  async function json(opts) {
    let spent = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await call(attempt ? { ...opts, maxTokens: Math.round((opts.maxTokens || 4000) * 1.5) } : opts);
      spent += r.cost;
      try {
        return { value: parseJsonObject(r.text), cost: spent };
      } catch (e) {
        if (attempt === 1) throw Object.assign(e, { cost: spent });
      }
    }
  }

  /** Stream text deltas to onText; resolves with the full text and cost. */
  async function stream(opts, onText) {
    const res = await request({ ...opts, stream: true });
    if (!res.ok) {
      console.warn('AI stream failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
      throw httpError(res.status);
    }
    const usage = { input_tokens: 0, output_tokens: 0 };
    let text = '';
    let buffer = '';
    const decoder = new TextDecoder();
    const handle = (raw) => {
      const line = raw.split('\n').find((l) => l.startsWith('data:'));
      if (!line) return;
      let evt;
      try {
        evt = JSON.parse(line.slice(5).trim());
      } catch {
        return;
      }
      if (evt.type === 'message_start') Object.assign(usage, evt.message?.usage || {});
      else if (evt.type === 'message_delta' && evt.usage) usage.output_tokens = evt.usage.output_tokens ?? usage.output_tokens;
      else if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        text += evt.delta.text;
        onText(evt.delta.text);
      } else if (evt.type === 'error') throw new AiError('The AI service had a problem. Try again.');
    };
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        handle(buffer.slice(0, i));
        buffer = buffer.slice(i + 2);
      }
    }
    if (buffer.trim()) handle(buffer);
    return { text, usage, cost: costOf(opts.model, usage) };
  }

  return { enabled, call, json, stream };
}
