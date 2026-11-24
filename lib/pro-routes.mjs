// HTTP routes for Fieldwork Pro. Every route: same-origin JSON POST, AI
// configured, Pro access, one unit of that tool's monthly allowance, then the work.
import { AiError } from './ai.mjs';
import { gatherLab, writeBriefing, writeEmail } from './outreach.mjs';
import { sniff, docxText, MAX_UPLOAD_BYTES } from './docs.mjs';
import { transcribePdf, review, buildApplication, interviewQuestions, interviewFeedback, letterKit, coachRequest } from './tools.mjs';

const ROUTES = {
  '/api/pro/briefing': { action: 'briefing' },
  '/api/pro/email': { action: 'email' },
  '/api/pro/resume-import': { action: 'import', limit: Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 4096 },
  '/api/pro/review': { action: 'review' },
  '/api/pro/application': { action: 'application' },
  '/api/pro/interview/start': { action: 'interview' },
  '/api/pro/interview/answer': { action: 'chat' },
  '/api/pro/letter': { action: 'letter' },
  '/api/pro/coach': { action: 'chat', stream: true },
};

const PRO_ERRORS = {
  not_pro: [402, 'This is a Pro feature.', 'pro_required'],
  limit: [429, 'You’ve used this month’s Pro allowance for this tool. It resets on the 1st.', 'pro_limit'],
  budget: [503, 'Pro tools are paused for today. Try again tomorrow.', 'pro_paused'],
  unavailable: [503, 'Couldn’t check your Pro plan. Try again.', 'pro_unavailable'],
};

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

async function readBody(req, limit) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error('That’s too large to send.'), { status: 413 });
  }
  return raw;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function extractPage(url, { tavilyKey, fetchImpl }) {
  if (!tavilyKey) throw new AiError('Paste the listing text instead; page reading isn’t set up.', 422, 'paste_needed');
  const res = await fetchImpl('https://api.tavily.com/extract', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tavilyKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: [url], extract_depth: 'basic' }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => ({})) : {};
  const text = String(data.results?.[0]?.raw_content || '');
  if (text.length < 200)
    throw new AiError('We couldn’t read that page. Copy the listing text from your browser and paste it instead.', 422, 'paste_needed');
  return text;
}

/** Handles /api/pro/* routes. Returns true when it answered the request. */
export async function handlePro(req, res, url, ctx) {
  const route = ROUTES[url.pathname];
  if (!route || req.method !== 'POST') return false;
  const { send, ai, pro, research, env, fetchImpl, clock, gatherCache } = ctx;
  if (!sameOrigin(req)) return send(403, { error: 'Cross-origin requests are not allowed.' }), true;
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'Send JSON.' }), true;
  if (!ai.enabled) return send(503, { error: 'Pro tools aren’t switched on yet.', code: 'ai_not_configured' }), true;
  let input;
  try {
    input = obj(JSON.parse(await readBody(req, route.limit || 64 * 1024)));
  } catch (e) {
    return send(e.status || 400, { error: e.status ? e.message : 'Invalid JSON.' }), true;
  }
  const who = await pro.identify(req);
  if (!who || who.plan === 'free') return send(402, { error: PRO_ERRORS.not_pro[1], code: 'pro_required' }), true;

  const profile = obj(input.profile);
  const resume = str(input.resume, 8000);

  // Validate before spending allowance.
  let lab = null;
  if (route.action === 'briefing' || route.action === 'email') {
    lab = await research.findLab(String(input.labId || ''));
    if (!lab) return send(404, { error: 'That lab isn’t in our list anymore. Search again.' }), true;
  }
  let coach = null;
  try {
    if (route.stream) coach = coachRequest({ messages: input.messages, profile, resume, workspace: input.workspace });
    if (route.action === 'review' && str(input.text, 20000).trim().length < 80)
      throw new AiError('Add the full text to review (at least a few lines).', 400, 'bad_request');
    if (route.action === 'application') {
      const pasted = str(input.text, 40000).trim();
      if (pasted.length < 200 && !/^https:\/\/[^\s]+$/.test(str(input.url, 2000)))
        throw new AiError('Add a listing link that starts with https://, or paste the listing text.', 400, 'bad_request');
    }
    if (route.action === 'chat' && url.pathname.endsWith('/answer') && str(input.answer, 4000).trim().length < 2)
      throw new AiError('Write an answer first.', 400, 'bad_request');
    if (route.action === 'letter' && !str(input.recommender, 100).trim())
      throw new AiError('Add who you’re asking.', 400, 'bad_request');
  } catch (e) {
    if (e instanceof AiError) return send(e.status, { error: e.message, code: e.code }), true;
    throw e;
  }

  const quota = await pro.consume(who, route.action);
  if (!quota.ok) {
    const [status, error, code] = PRO_ERRORS[quota.reason] || PRO_ERRORS.unavailable;
    return send(status, { error, code }), true;
  }
  const log = (cost) => {
    pro.record(cost);
    console.log(`AI ${route.action} ${url.pathname} $${(cost || 0).toFixed(4)} (${who.kind})`);
  };

  if (route.stream) {
    res.writeHead(200, {
      ...ctx.headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      const { cost } = await ai.stream(coach, (t) => emit({ t }));
      log(cost);
      emit({ done: true, remaining: quota.remaining });
    } catch (e) {
      emit({ error: e instanceof AiError ? e.message : 'Something went wrong. Try again.' });
    }
    res.end();
    return true;
  }

  try {
    let out;
    switch (url.pathname) {
      case '/api/pro/briefing': {
        let cached = gatherCache.get(lab.id);
        if (!cached || clock() - cached.at > 86400000) {
          cached = { at: clock(), value: await gatherLab(lab, { fetchImpl, tavilyKey: env.TAVILY_API_KEY, mailto: env.CONTACT_EMAIL }) };
          gatherCache.set(lab.id, cached);
          if (gatherCache.size > 300) gatherCache.delete(gatherCache.keys().next().value);
        }
        const g = cached.value;
        const { briefing, cost } = await writeBriefing(ai, lab, g, profile, resume);
        log(cost);
        out = {
          briefing,
          emails: g.emails,
          labUrl: g.labUrl,
          papers: g.papers.map(({ title, year, venue, url: link }) => ({ title, year, venue, url: link })),
        };
        break;
      }
      case '/api/pro/email': {
        const { email, cost } = await writeEmail(ai, lab, obj(input.briefing), profile, resume, {
          kind: input.kind === 'followup' ? 'followup' : 'first',
          previous: str(input.previous, 4000),
        });
        log(cost);
        out = { email };
        break;
      }
      case '/api/pro/resume-import': {
        const buf = Buffer.from(str(input.data, route.limit), 'base64');
        if (!buf.length || buf.length > MAX_UPLOAD_BYTES) throw new AiError('Upload a file under 4 MB.', 413, 'too_large');
        const type = sniff(buf);
        let text = '';
        if (type === 'pdf') {
          const r = await transcribePdf(ai, buf.toString('base64'));
          log(r.cost);
          text = r.text;
        } else if (type === 'zip') {
          try {
            text = docxText(buf);
          } catch (e) {
            throw new AiError(e.message || 'We couldn’t read that Word file.', 422, 'unreadable');
          }
        } else if (type === 'text') {
          text = buf.toString('utf8');
        } else {
          throw new AiError('Upload a PDF, a Word (.docx) file or a text file.', 415, 'bad_type');
        }
        text = text.replace(/\r/g, '').trim().slice(0, 12000);
        if (text.length < 40) throw new AiError('We couldn’t find text in that file. Try pasting it instead.', 422, 'unreadable');
        out = { text };
        break;
      }
      case '/api/pro/review': {
        const r = await review(ai, {
          kind: input.kind === 'essay' ? 'essay' : 'resume',
          text: str(input.text, 20000),
          prompt: str(input.prompt, 3000),
          target: str(input.target, 6000),
          profile,
        });
        log(r.cost);
        out = { review: r.result };
        break;
      }
      case '/api/pro/application': {
        const target = str(input.url, 2000);
        const page = str(input.text, 40000).trim().length >= 200 ? str(input.text, 40000) : await extractPage(target, { tavilyKey: env.TAVILY_API_KEY, fetchImpl });
        const r = await buildApplication(ai, {
          page,
          url: target,
          title: str(input.title, 300),
          profile,
          resume,
          today: new Date(clock()).toISOString().slice(0, 10),
        });
        log(r.cost);
        out = { application: r.result };
        break;
      }
      case '/api/pro/interview/start': {
        const r = await interviewQuestions(ai, { role: str(input.role, 300), details: str(input.details, 4000), profile, resume });
        log(r.cost);
        out = { interview: r.result };
        break;
      }
      case '/api/pro/interview/answer': {
        const r = await interviewFeedback(ai, { role: str(input.role, 300), question: str(input.question, 600), answer: str(input.answer, 4000), profile });
        log(r.cost);
        out = { feedback: r.result };
        break;
      }
      case '/api/pro/letter': {
        const r = await letterKit(ai, {
          recommender: str(input.recommender, 100),
          relation: str(input.relation, 200),
          knows: str(input.knows, 2000),
          target: str(input.target, 2000),
          deadline: str(input.deadline, 40),
          profile,
          resume,
        });
        log(r.cost);
        out = { letter: r.result };
        break;
      }
    }
    send(200, { ...out, remaining: quota.remaining });
  } catch (e) {
    if (e?.cost) log(e.cost);
    if (e instanceof AiError) send(e.status, { error: e.message, code: e.code });
    else {
      console.error('Pro request failed:', e);
      send(500, { error: 'Something went wrong. Try again.' });
    }
  }
  return true;
}
