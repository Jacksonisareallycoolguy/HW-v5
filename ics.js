// Generated from the app's calendar parser (see index.html). Do not edit by hand.

function unfold(t){return t.replace(/\r?\n[ \t]/g,'')}
function unesc(s){return String(s||'').replace(/\\n/gi,' ').replace(/\\([,;\\])/g,'$1').trim()}
function pd(v){const m=String(v||'').trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);if(!m)return null;
  const [,y,mo,d,h,mi,s,z]=m;
  if(!h)return{date:new Date(+y,+mo-1,+d,23,59),allDay:true,z:false};
  return{date:z?new Date(Date.UTC(+y,+mo-1,+d,+h,+mi,+s)):new Date(+y,+mo-1,+d,+h,+mi,+s),allDay:false,z:!!z}}
const day0=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
const dkey=d=>d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
function monthCells(y,m){
  const first=new Date(y,m,1),n=new Date(y,m+1,0).getDate();
  const total=Math.ceil((first.getDay()+n)/7)*7,out=[];
  for(let i=0;i<total;i++)out.push(new Date(y,m,1-first.getDay()+i));
  return out}

/* repeating events (simple rules only: daily, weekly with days, monthly by date, yearly) */
const DOW={MO:0,TU:1,WE:2,TH:3,FR:4,SA:5,SU:6};
function ruleOf(s){const o={};for(const p of String(s).split(';')){const i=p.indexOf('=');if(i>0)o[p.slice(0,i).toUpperCase()]=p.slice(i+1)}return o}
function addDays(d,n,utc){const x=new Date(d);utc?x.setUTCDate(x.getUTCDate()+n):x.setDate(x.getDate()+n);return x}
function addMonths(d,n,utc){
  const x=new Date(d),day=utc?x.getUTCDate():x.getDate();
  utc?x.setUTCDate(1):x.setDate(1);
  utc?x.setUTCMonth(x.getUTCMonth()+n):x.setMonth(x.getMonth()+n);
  const dim=utc?new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).getUTCDate():new Date(x.getFullYear(),x.getMonth()+1,0).getDate();
  if(day>dim)return null;
  utc?x.setUTCDate(day):x.setDate(day);return x}
function expand(ds,ruleStr,wEnd){
  const r=ruleOf(ruleStr),f=r.FREQ,n=Math.max(1,+r.INTERVAL||1),cap=r.COUNT?+r.COUNT:Infinity;
  const u=r.UNTIL?pd(r.UNTIL):null,until=u?u.date:null,utc=ds.z,start=ds.date,out=[];
  if(r.BYSETPOS||(f==='MONTHLY'&&(r.BYDAY||(r.BYMONTHDAY&&+r.BYMONTHDAY!==(utc?start.getUTCDate():start.getDate()))))||/\d/.test(r.BYDAY||''))return [start];
  let count=0;
  const push=d=>{if(d<start)return true;if(until&&d>until)return false;if(d>wEnd)return false;out.push(d);count++;return count<cap};
  if(f==='DAILY'){for(let i=0;i<4000;i++)if(!push(addDays(start,i*n,utc)))break}
  else if(f==='WEEKLY'){
    const sd=utc?start.getUTCDay():start.getDay();
    const days=r.BYDAY?r.BYDAY.split(',').map(x=>DOW[x.slice(-2)]).filter(x=>x!==undefined).sort((a,b)=>a-b):[(sd+6)%7];
    const base=addDays(start,-((sd+6)%7),utc);
    outer:for(let w=0;w<700;w++)for(const dy of days)if(!push(addDays(base,w*7*n+dy,utc)))break outer}
  else if(f==='MONTHLY'){for(let i=0;i<500;i++){const d=addMonths(start,i*n,utc);if(!d)continue;if(!push(d))break}}
  else if(f==='YEARLY'){for(let i=0;i<100;i++){const d=addMonths(start,12*i*n,utc);if(!d)continue;if(!push(d))break}}
  else return [start];
  return out}

function parseICS(text,o){
  o=o||{};const wS=o.wS||new Date(0),wE=o.wE||new Date(2100,0,1);
  const calm=(text.match(/^X-WR-CALNAME[^:\r\n]*:(.*)$/m)||[])[1];
  const defCourse=o.defaultCourse||(calm?unesc(calm):'Calendar');
  const raw=[],ov=new Set();
  const okey=(uid,ds)=>uid+'|'+(ds.allDay?dkey(ds.date):ds.date.getTime());
  for(const b of unfold(text).split('BEGIN:VEVENT').slice(1)){
    const f={};
    for(const line of b.split('END:VEVENT')[0].split(/\r?\n/)){
      const i=line.indexOf(':');if(i<1)continue;
      const k=line.slice(0,i).split(';')[0].toUpperCase(),val=line.slice(i+1);
      if(k==='EXDATE')f.EXDATE=(f.EXDATE?f.EXDATE+',':'')+val;else if(!(k in f))f[k]=val}
    if(/CANCELLED/i.test(f.STATUS||''))continue;
    const ds=f.DTSTART&&pd(f.DTSTART);if(!ds||!f.SUMMARY)continue;
    const uid=(f.UID||f.SUMMARY+f.DTSTART).trim();
    if(f['RECURRENCE-ID']){const rid=pd(f['RECURRENCE-ID']);if(rid)ov.add(okey(uid,rid))}
    raw.push({f,ds,uid})}
  const out=[];
  for(const {f,ds,uid} of raw){
    let title=unesc(f.SUMMARY),course=defCourse;
    if(o.bracket){const m=title.match(/\s*\[([^\]]+)\]\s*$/);course='Other';if(m){course=m[1];title=title.slice(0,m.index)}}
    let dates=[ds.date];
    if(f.RRULE&&!f['RECURRENCE-ID']){
      const ex=new Set((f.EXDATE||'').split(',').map(pd).filter(Boolean).map(x=>x.allDay?dkey(x.date):x.date.getTime()));
      dates=expand(ds,f.RRULE,wE).filter(d=>{const k=ds.allDay?dkey(d):d.getTime();return !ex.has(k)&&!ov.has(uid+'|'+k)})}
    for(const d of dates){
      if(d<wS||d>wE)continue;
      out.push({id:(o.src||'x')+':'+uid+(f.RRULE?'@'+d.getTime():''),title,course,due:d,allDay:ds.allDay,z:ds.z,url:(f.URL||'').trim(),src:o.src||'x',kind:o.kind||'assignment'})}}
  return out.sort((a,b)=>a.due-b.due)}
function customToEvent(c){
  const m=String(c.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;
  let d=new Date(+m[1],+m[2]-1,+m[3],23,59),allDay=true;
  const t=String(c.time||'').match(/^(\d{2}):(\d{2})$/);
  if(t){d=new Date(+m[1],+m[2]-1,+m[3],+t[1],+t[2]);allDay=false}
  return{id:c.id,title:c.title,course:c.course||'Personal',due:d,allDay,url:'',src:'custom',kind:c.type||'assignment'}}

module.exports={parseICS,pd,customToEvent};
