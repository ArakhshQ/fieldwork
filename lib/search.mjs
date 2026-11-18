import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
export class SearchError extends Error {
  constructor(message,status=502,code='search_failed'){super(message);this.status=status;this.code=code;}
}
export function normalizeInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new SearchError('Enter a search query.',400,'invalid_input');
  const clean=(v,max)=>typeof v==='string'?v.replace(/[\x00-\x1f]/g,' ').trim().slice(0,max):'';
  const q=clean(input.q,240),location=clean(input.location,100);
  if(q.length<2)throw new SearchError('Use at least two characters.',400,'invalid_input');
  return {q,location,type:['all','research','internship'].includes(input.type)?input.type:'all',remote:input.remote===true,paid:input.paid===true,social:input.social===true,level:clean(input.level,40),season:clean(input.season,40),experience:clean(input.experience,60),duration:clean(input.duration,40),housing:input.housing===true,international:input.international===true};
}
export function planQueries(input,now=new Date()){
  const p=normalizeInput(input),year=now.getUTCFullYear();
  const topic=[p.q,p.location,p.remote?'remote':'',p.paid?'paid funded stipend':'',p.level,p.season,p.experience,p.duration,p.housing?'housing provided':'',p.international?'international applicants eligible':''].filter(Boolean).join(' ');
  const dates=/\b20\d{2}\b/.test(p.q+' '+p.season)?'':`${year} ${year+1}`;
  const queries=[`${topic} ${p.type==='all'?'student internships undergraduate research opportunities':p.type==='research'?'student research opportunities':'student internship opportunities'} applications ${dates}`];
  if(p.type!=='internship')queries.push(`${topic} university summer research program applications open deadline ${dates}`);
  if(p.type!=='research')queries.push(`${topic} internship careers apply hiring ${dates}`);
  if(p.social)queries.push(`${topic} research internship applications open (site:reddit.com OR site:x.com OR site:linkedin.com OR site:instagram.com OR site:tiktok.com) ${dates}`);
  return queries.map(q=>q.replace(/\s+/g,' ').trim());
}
export function safeUrl(value){
  try{const u=new URL(value);const h=u.hostname.toLowerCase();
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||isIP(h)||h.startsWith('[')||!h.includes('.')||/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(h))return null;
    u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k)||['fbclid','gclid','ref'].includes(k))u.searchParams.delete(k);
    u.searchParams.sort();return u.toString().replace(/\/$/,'');
  }catch{return null;}
}
const socialDomain=h=>/(^|\.)(reddit\.com|x\.com|twitter\.com|instagram\.com|tiktok\.com|linkedin\.com|facebook\.com)$/.test(h);
const text=v=>typeof v==='string'?v.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim():'';
const excerpt=(body,pattern)=>{const m=body.match(pattern);return m?body.slice(Math.max(0,m.index-60),Math.min(body.length,m.index+m[0].length+130)).trim():'';};
export function analyzeResult(result,raw,now=new Date()){
  const url=safeUrl(result.url);if(!url)return null;
  const body=text(raw),snippet=text(result.content),title=text(result.title).slice(0,250),host=new URL(url).hostname.replace(/^www\./,'');
  if(!/\b(intern(?:ship)?s?|research|fellowship|reu|co-op|placement)\b/i.test(title+' '+snippet+' '+body.slice(0,2000)))return null;
  const social=socialDomain(host),extracted=body.length>80;
  const closing=/\b(applications? (?:are |is |have )?(?:now |been )?closed|no longer accepting applications|position (?:has been |is )?filled|job (?:is )?no longer available)\b/i;
  const opening=/\b(applications? (?:are |is )?(?:currently |now )?open|now accepting applications|currently accepting applications)\b/i;
  const closeEvidence=extracted?excerpt(body,closing):'';
  const openEvidence=extracted?excerpt(body,opening):'';
  // Signals are quoted, not treated as verified current availability. Old-cycle text may coexist.
  const status=closeEvidence?'closed_signal':openEvidence&&!social?'open_signal':'unknown';
  const payPattern=/\b(?:stipend|hourly (?:pay|rate)|salary range|compensation range)\b|\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:per|\/)?\s*(?:hour|hr|week|month)\b/i;
  const fundingEvidence=extracted?excerpt(body,payPattern):'';
  const eligibilityEvidence=extracted?excerpt(body,/\b(eligib(?:ility|le)|citizenship|work authori[sz]ation|must be enrolled|undergraduate students)\b/i):'';
  const deadlineEvidence=extracted?excerpt(body,/\b(application deadline|apply by|applications? close[sd]?|closing date)\b/i):'';
  const kind=/\b(intern(?:ship)?s?|co-op)\b/i.test(title)?'Internship':/\b(research|reu|fellowship)\b/i.test(title)?'Research':'Opportunity';
  const officialHint=/\.(edu|gov)(\.|$)/i.test(host)||/(greenhouse\.io|lever\.co|myworkdayjobs\.com|ashbyhq\.com)$/.test(host);
  return {id:createHash('sha256').update(url).digest('hex').slice(0,20),url,title:title||host,host,kind,sourceType:social?'Social lead':officialHint?'Institution / hiring page':'Web result',snippet:snippet.slice(0,650),status,evidence:closeEvidence||openEvidence,deadlineEvidence,fundingEvidence,eligibilityEvidence,extracted,foundAt:now.toISOString(),extractedAt:extracted?now.toISOString():null,publishedDate:typeof result.published_date==='string'?result.published_date:null,score:Math.max(0,Math.min(1,Number(result.score)||0)),officialHint};
}
export function createSearchService({apiKey,fetchImpl=fetch,now=()=>new Date()}={}){
  async function call(endpoint,body){
    let response;
    try{response=await fetchImpl(`https://api.tavily.com/${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});}catch{throw new SearchError('The search provider did not respond. Please retry.');}
    if(!response.ok){if(response.status===401||response.status===403)throw new SearchError('The search provider key needs attention. Ask the site owner to check it.',503,'provider_auth');if(response.status===429||response.status===432)throw new SearchError('The search provider limit was reached. Please try later.',503,'provider_limit');throw new SearchError('The search provider is temporarily unavailable.');}
    try{return await response.json();}catch{throw new SearchError('The search provider returned an unreadable response.');}
  }
  return async function search(input,{onProgress=()=>{}}={}){
    const preferences=normalizeInput(input);
    if(!apiKey)throw new SearchError('Search is temporarily unavailable. Please try again later.',503,'setup_required');
    const started=now(),queries=planQueries(preferences,started);onProgress('searching');
    const searches=await Promise.allSettled(queries.map(query=>call('search',{query,search_depth:'basic',topic:'general',max_results:8,include_raw_content:false,include_answer:false,auto_parameters:false})));
    const good=searches.filter(r=>r.status==='fulfilled');
    if(!good.length)throw searches[0].reason;
    const warnings=[];if(good.length!==queries.length)warnings.push(`${queries.length-good.length} search queries failed; coverage is partial.`);
    const unique=new Map();
    for(const response of good){for(const item of (response.value.results||[])){const url=safeUrl(item.url);if(!url)continue;const existing=unique.get(url);if(!existing||(Number(item.score)||0)>(Number(existing.score)||0))unique.set(url,{...item,url});}}
    const candidates=[...unique.values()].filter(r=>analyzeResult(r,'',started)).sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)).slice(0,16);
    onProgress('reading');let extracted=new Map();
    if(candidates.length){try{const data=await call('extract',{urls:candidates.map(x=>x.url),extract_depth:'basic',format:'text'});extracted=new Map((data.results||[]).map(r=>[safeUrl(r.url),r.raw_content]));if((data.failed_results||[]).length)warnings.push('Some pages could not be read. These remain unverified leads.');}catch{warnings.push('Page reading is unavailable. Results are search snippets, not verified openings.');}}
    onProgress('ranking');
    const results=candidates.map(r=>analyzeResult(r,extracted.get(r.url)||'',started)).filter(Boolean);
    results.sort((a,b)=>((b.status==='open_signal'?2:0)+(b.officialHint?.4:0)+b.score)-((a.status==='open_signal'?2:0)+(a.officialHint?.4:0)+a.score));
    return {results,queries,searchedAt:started.toISOString(),warnings,stats:{queries:queries.length,queriesSucceeded:good.length,candidates:unique.size,pagesRead:results.filter(r=>r.extracted).length},notice:'Fresh web discovery; provider indexes and page extracts can be delayed. Open/closed wording is a page signal, not a verified vacancy. Confirm the application cycle, eligibility and deadline at the source.'};
  };
}
