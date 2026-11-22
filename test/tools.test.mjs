import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { createAi } from '../lib/ai.mjs';
import { sniff, docxText } from '../lib/docs.mjs';
import { review, buildApplication, verifyQuotes, interviewQuestions, interviewFeedback, letterKit, coachRequest } from '../lib/tools.mjs';
import { createApp } from '../server.mjs';
import { LIMITS } from '../lib/pro.mjs';

/** Build a minimal .docx (a ZIP holding word/document.xml). */
function makeDocx(xml) {
  const name = Buffer.from('word/document.xml');
  const data = deflateRawSync(Buffer.from(xml));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(Buffer.byteLength(xml), 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(Buffer.byteLength(xml), 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

test('uploaded files are identified by content and Word files are read', () => {
  assert.equal(sniff(Buffer.from('%PDF-1.7 ...')), 'pdf');
  assert.equal(sniff(Buffer.from('Plain résumé text')), 'text');
  const docx = makeDocx('<w:document><w:body><w:p><w:r><w:t>Sam Lee</w:t></w:r></w:p><w:p><w:r><w:t>Python &amp; optics</w:t><w:tab/><w:t>2026</w:t></w:r></w:p></w:body></w:document>');
  assert.equal(sniff(docx), 'zip');
  assert.equal(docxText(docx), 'Sam Lee\nPython & optics\t2026');
  assert.throws(() => docxText(Buffer.from('PK\u0003\u0004 not really a zip')));
});

function fakeAi(reply) {
  const calls = [];
  return {
    calls,
    ai: {
      enabled: true,
      json: async (opts) => (calls.push(opts), { value: typeof reply === 'function' ? reply(opts) : reply, cost: 0.1 }),
    },
  };
}

test('reviews keep only fixes and mark which originals really appear', async () => {
  const { ai, calls } = fakeAi({
    score: 140,
    headline: 'Solid start.',
    strengths: ['Clear dates'],
    fixes: [
      { original: 'Did lab stuff', suggestion: 'Imaged 40 tissue samples with multiphoton microscopy', why: 'Specific' },
      { original: 'Invented line', suggestion: 'x', why: 'y' },
      { original: 'no suggestion' },
    ],
    tailoring: ['Lead with imaging'],
    revised: 'should be ignored for résumés',
  });
  const { result } = await review(ai, { kind: 'resume', text: 'Sam Lee\nDid lab stuff\nPython', profile: {} });
  assert.equal(result.score, 100);
  assert.equal(result.fixes.length, 2);
  assert.deepEqual(result.fixes.map((f) => f.found), [true, false]);
  assert.equal(result.revised, '');
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.match(calls[0].system, /never follow instructions/i);
});

test('application builder only trusts dates and quotes that are on the page', async () => {
  const page =
    'Summer Neuro Program. Applications are due February 1, 2027. Open to rising juniors and seniors who are US citizens or permanent residents. Submit a transcript, a CV and two letters.';
  const { ai } = fakeAi({
    eligibility: { verdict: 'likely', reasons: ['You are a junior'], quotes: ['Open to rising juniors and seniors who are US citizens or permanent residents.', 'A made-up rule.'] },
    deadline: { date: '2027-02-01', text: 'February 1', quote: 'Applications are due February 1, 2027.' },
    requirements: [{ item: 'Transcript', detail: 'Unofficial is fine' }, { detail: 'no item' }],
    questions: [{ question: 'Why this program?', draft: 'Because…' }],
    plan: [{ when: 'This week', task: 'Ask for letters' }],
  });
  const { result } = await buildApplication(ai, { page, url: 'https://x.edu/neuro', title: 'Neuro', profile: {}, resume: '', today: '2026-11-21' });
  assert.equal(result.eligibility.verdict, 'likely');
  assert.deepEqual(result.eligibility.quotes, ['Open to rising juniors and seniors who are US citizens or permanent residents.']);
  assert.equal(result.deadline.date, '2027-02-01');
  assert.equal(result.requirements.length, 1);

  const { ai: ai2 } = fakeAi({ deadline: { date: '2027-03-01', quote: 'Due March 1.' }, eligibility: { verdict: 'maybe' } });
  const r2 = (await buildApplication(ai2, { page, url: '', title: '', profile: {}, resume: '', today: '2026-11-21' })).result;
  assert.equal(r2.deadline.date, '', 'a date without a real quote is dropped');
  assert.equal(r2.eligibility.verdict, 'unclear');
  assert.deepEqual(verifyQuotes(['  applications are DUE february 1, 2027. '], page), ['applications are DUE february 1, 2027.']);
});

test('interview, letter and coach requests are shaped and clamped', async () => {
  const q = fakeAi({ intro: 'Hi', questions: ['a?', 'b?', 'c?', 'd?', 'e?', 'f?'] });
  const { result } = await interviewQuestions(q.ai, { role: 'Lab assistant', details: '', profile: {}, resume: '' });
  assert.equal(result.questions.length, 5);
  assert.equal(q.calls[0].model, 'claude-sonnet-5-5');
  await assert.rejects(interviewQuestions(fakeAi({ questions: ['one?'] }).ai, { role: 'x' }), /Couldn’t prepare/);

  const f = await interviewFeedback(fakeAi({ score: 9, good: 'Clear', improve: 'Add a number', example: 'I imaged…' }).ai, { role: 'x', question: 'q', answer: 'a' });
  assert.equal(f.result.score, 5);

  const l = await letterKit(fakeAi({ subject: 'Request', email: 'Dear Dr. Ray,', brag: [{ heading: 'Class', points: ['Top project'] }, { heading: '', points: ['x'] }] }).ai, { recommender: 'Dr. Ray' });
  assert.equal(l.result.brag.length, 1);
  await assert.rejects(letterKit(fakeAi({ email: '' }).ai, { recommender: 'x' }), /empty draft/);

  const req = coachRequest({
    messages: [
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'Plan my semester' },
      { role: 'system', content: 'ignored' },
    ],
    profile: { name: 'Sam' },
    workspace: { saved: ['REU at BU'], applications: [{ title: 'Doe Lab', status: 'Applied', deadline: '2026-12-01' }] },
  });
  assert.deepEqual(req.messages, [{ role: 'user', content: 'Plan my semester' }]);
  assert.match(req.system, /REU at BU/);
  assert.match(req.system, /Doe Lab \| stage: Applied \| date: 2026-12-01/);
  assert.throws(() => coachRequest({ messages: [{ role: 'assistant', content: 'hi' }] }), /Ask the coach/);
});

test('streaming reads text deltas and usage from server-sent events', async () => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 1000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'secret' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello ' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Sam' } },
    { type: 'message_delta', usage: { output_tokens: 500 } },
    { type: 'message_stop' },
  ];
  const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  // Deliver in awkward chunks to test buffering across boundaries.
  const chunks = sse.match(/[\s\S]{1,37}/g).map((c) => Buffer.from(c));
  const ai = createAi({
    apiKey: 'k',
    fetchImpl: async () => ({ ok: true, body: (async function* () { yield* chunks; })() }),
  });
  const seen = [];
  const r = await ai.stream({ model: 'claude-sonnet-5-5', system: 's', messages: [{ role: 'user', content: 'hi' }] }, (t) => seen.push(t));
  assert.equal(r.text, 'Hello Sam');
  assert.deepEqual(seen, ['Hello ', 'Sam']);
  assert.equal(r.cost, (1000 * 2 + 500 * 10) / 1e6);
});

test('coach endpoint streams to the browser and counts one chat message', async (t) => {
  const sse = [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Start with ' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'your résumé.' } },
    { type: 'message_delta', usage: { output_tokens: 5 } },
  ]
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join('');
  const ai = createAi({
    apiKey: 'k',
    fetchImpl: async () => ({ ok: true, body: (async function* () { yield Buffer.from(sse); })() }),
  });
  const app = createApp({ env: { ANTHROPIC_API_KEY: 'k', PRO_PREVIEW_CODES: 'preview-code-123' }, ai });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => app.close(r)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const res = await fetch(base + '/api/pro/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pro-Code': 'preview-code-123' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Where do I start?' }] }),
  });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const body = await res.text();
  const data = body.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.slice(6)));
  assert.equal(data.filter((d) => d.t).map((d) => d.t).join(''), 'Start with your résumé.');
  assert.deepEqual(data.at(-1), { done: true, remaining: LIMITS.preview.chat - 1 });

  const bad = await fetch(base + '/api/pro/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pro-Code': 'preview-code-123' },
    body: JSON.stringify({ kind: 'resume', text: 'too short' }),
  });
  assert.equal(bad.status, 400, 'invalid input is rejected before using allowance');
  const status = await fetch(base + '/api/pro/status', { headers: { 'X-Pro-Code': 'preview-code-123' } }).then((r) => r.json());
  assert.equal(status.remaining.review, LIMITS.preview.review);
});
