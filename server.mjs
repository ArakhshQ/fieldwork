import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {createSearchService,SearchError} from './lib/search.mjs';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
const equal=(a,b)=>{const aa=Buffer.from(a||''),bb=Buffer.from(b||'');return aa.length===bb.length&&timingSafeEqual(aa,bb)};
export function createApp({env=process.env,search=createSearchService({apiKey:env.TAVILY_API_KEY}),clock=()=>Date.now()}={}){
  let active=0,day='',daily=0;const rates=new Map();
  const maxDaily=Number(env.MAX_SEARCHES_PER_DAY)||100,maxConcurrent=Number(env.MAX_CONCURRENT_SEARCHES)||3;
  return http.createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{...headers,'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/health')return send(200,{status:'ok',searchConfigured:!!env.TAVILY_API_KEY});
    if(req.method==='GET'&&url.pathname==='/api/config')return send(200,{searchConfigured:!!env.TAVILY_API_KEY,accessCodeRequired:!!env.SEARCH_ACCESS_CODE});
    if(req.method==='POST'&&url.pathname==='/api/search'){
      const origin=req.headers.origin;
      if(origin){try{if(new URL(origin).host!==req.headers.host)return send(403,{error:'Cross-origin searches are not allowed.'});}catch{return send(403,{error:'Invalid origin.'});}}
      if(env.SEARCH_ACCESS_CODE&&!equal(req.headers['x-search-access-code'],env.SEARCH_ACCESS_CODE))return send(401,{error:'Enter the beta access code.',code:'access_required'});
      if(!String(req.headers['content-type']||'').startsWith('application/json'))return send(415,{error:'Send JSON.'});
      let raw='';try{for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw new SearchError('Search request is too large.',413);}}catch(e){return send(e.status||400,{error:e.message});}
      let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'Invalid JSON.'});}
      const today=new Date(clock()).toISOString().slice(0,10);if(day!==today){daily=0;day=today;}
      // Deliberately ignore untrusted forwarded IP headers. Behind a proxy this is a conservative shared limit.
      const ip=req.socket.remoteAddress||'unknown',bucket=rates.get(ip)||{count:0,until:clock()+60000};
      if(clock()>bucket.until){bucket.count=0;bucket.until=clock()+60000;}
      if(bucket.count>=10||daily>=maxDaily)return send(429,{error:'Search limit reached. Please try again later.',code:'rate_limited'});
      if(active>=maxConcurrent)return send(429,{error:'A few searches are running. Please try again shortly.',code:'busy'});
      if(!env.TAVILY_API_KEY)return send(503,{error:'Live search needs a search-provider key. Add TAVILY_API_KEY in Render’s Environment settings.',code:'setup_required'});
      bucket.count++;rates.set(ip,bucket);daily++;active++;
      if(rates.size>10000)for(const[k,v]of rates)if(v.until<clock())rates.delete(k);
      try{const data=await search(input);return send(200,data);}catch(e){return send(e.status||500,{error:e instanceof SearchError?e.message:'Search could not complete. Please retry.',code:e.code||'search_failed'});}finally{active--;}
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed.'});
    const files={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/favicon.svg':'favicon.svg'};
    const file=files[url.pathname];if(!file)return send(404,{error:'Not found.'});
    try{const bytes=await readFile(path.join(root,file));const mime=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html';res.writeHead(200,{...headers,'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);}catch{return send(500,{error:'Page could not be loaded.'});}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const portArg=process.argv.indexOf('--port');
 const hostArg=process.argv.indexOf('--host');
 const port=Number(process.env.PORT)||(portArg>=0?Number(process.argv[portArg+1]):3000);
 const host=hostArg>=0?process.argv[hostArg+1]:'0.0.0.0';
 const app=createApp();app.listen(port,host,()=>console.log('Fieldwork server ready')); 
 process.on('SIGTERM',()=>app.close(()=>process.exit(0)));
}
