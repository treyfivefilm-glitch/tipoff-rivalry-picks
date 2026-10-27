// Read-only, experimental NFL/MLB/NHL scoreboard adapter.
// Does not modify NBA rooms, wagers, or database picks.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
type Sport = "NFL"|"MLB"|"NHL";
type Game = { id:string; start_utc:string; away_code:string; away_name:string; home_code:string; home_name:string;
  away_score:number|null; home_score:number|null; state:"scheduled"|"live"|"final"|"postponed"; status_detail:string };
const cors = {"access-control-allow-origin":"*","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"authorization,apikey,content-type,x-client-info"};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"content-type":"application/json","cache-control":"public, max-age=60"}});
const number=(v:unknown):number|null=> v===null||v===undefined||v===""||!Number.isFinite(Number(v))?null:Number(v);
const text=(v:unknown):string=>typeof v==="string"?v:"";
const espnTeams=(c:unknown):{away:Record<string,unknown>|null;home:Record<string,unknown>|null}=>{
 const teams=Array.isArray(c)?c as Record<string,unknown>[]:[];
 return {away:teams.find(x=>x.homeAway==="away")??null,home:teams.find(x=>x.homeAway==="home")??null};
};
async function fetchJson(url:string):Promise<Record<string,unknown>> {
 const res=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(9000)});
 if(!res.ok)throw Error(`Provider HTTP ${res.status}`);
 return await res.json() as Record<string,unknown>;
}
async function nfl(date:string):Promise<Game[]> {
 const raw=await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date.replaceAll("-","")}`);
 return (Array.isArray(raw.events)?raw.events:[]).flatMap((value:unknown)=>{
   const e=value as Record<string,unknown>;
   const competition=(Array.isArray(e.competitions)?e.competitions:[])[0] as Record<string,unknown>|undefined;
   const {away,home}=espnTeams(competition?.competitors);
   if(!away||!home)return [];
   const info=e.status as Record<string,unknown>|undefined;
   const detail=info?.type as Record<string,unknown>|undefined;
   const state=detail?.state==="post"?"final":detail?.state==="in"?"live":"scheduled";
   const a=away.team as Record<string,unknown>|undefined,h=home.team as Record<string,unknown>|undefined;
   return [{id:"nfl:"+String(e.id),start_utc:String(e.date),away_code:text(a?.abbreviation),away_name:text(a?.displayName),
     home_code:text(h?.abbreviation),home_name:text(h?.displayName),away_score:state==="scheduled"?null:number(away.score),
     home_score:state==="scheduled"?null:number(home.score),state,status_detail:text(detail?.shortDetail)}] as Game[];
 });
}
async function nhl(date:string):Promise<Game[]> {
 const raw=await fetchJson(`https://api-web.nhle.com/v1/score/${date}`);
 return (Array.isArray(raw.games)?raw.games:[]).map((v:unknown)=>{
   const g=v as Record<string,unknown>,a=g.awayTeam as Record<string,unknown>|undefined,h=g.homeTeam as Record<string,unknown>|undefined;
   const code=(team:Record<string,unknown>|undefined)=>{
     const abbr=team?.abbrev as Record<string,unknown>|string|undefined;
     return typeof abbr==="string"?abbr:text(abbr?.default);
   };
   const gstate=text(g.gameState),state=gstate==="OFF"?"final":gstate==="LIVE"||gstate==="CRIT"?"live":"scheduled";
   return {id:"nhl:"+String(g.id),start_utc:String(g.startTimeUTC),away_code:code(a),away_name:code(a),
     home_code:code(h),home_name:code(h),away_score:state==="scheduled"?null:number(a?.score),
     home_score:state==="scheduled"?null:number(h?.score),state,status_detail:gstate} as Game;
 });
}
async function mlb(date:string):Promise<Game[]> {
 const raw=await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
 const dates=Array.isArray(raw.dates)?raw.dates:[];
 return dates.flatMap((v:unknown)=>{
  const segment=v as Record<string,unknown>;
  return (Array.isArray(segment.games)?segment.games:[]).map((game:unknown)=>{
    const g=game as Record<string,unknown>;
    const teams=g.teams as Record<string,unknown>|undefined;
    const a=teams?.away as Record<string,unknown>|undefined,h=teams?.home as Record<string,unknown>|undefined;
    const away=a?.team as Record<string,unknown>|undefined,home=h?.team as Record<string,unknown>|undefined;
    const stateInfo=g.status as Record<string,unknown>|undefined;
    const rawState=text(stateInfo?.abstractGameState);
    const state=rawState==="Final"?"final":rawState==="Live"?"live":rawState==="Postponed"?"postponed":"scheduled";
    const ab=(team:Record<string,unknown>|undefined)=>text(team?.abbreviation)||text(team?.name);
    return {id:"mlb:"+String(g.gamePk),start_utc:String(g.gameDate),
      away_code:ab(away),away_name:text(away?.name),home_code:ab(home),home_name:text(home?.name),
      away_score:state==="scheduled"?null:number(a?.score),home_score:state==="scheduled"?null:number(h?.score),
      state,status_detail:text(stateInfo?.detailedState)} as Game;
  });
 });
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return respond({});
 if(req.method!=="POST")return respond({error:"Method not allowed"},405);
 let payload:Record<string,unknown>;
 try{payload=await req.json() as Record<string,unknown>;}catch{return respond({error:"Invalid input"},400);}
 const sport=String(payload.sport??"").toUpperCase() as Sport;
 const date=String(payload.date??"");
 if(!["NFL","MLB","NHL"].includes(sport)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+"T12:00:00Z")))
   return respond({error:"Invalid sport or date"},400);
 const dayMs=Date.parse(date+"T12:00:00Z");
 if(Math.abs(dayMs-Date.now())>183*86400000) return respond({error:"Date outside preview range"},400);
 try {
   const games=(sport==="NFL"?await nfl(date):sport==="NHL"?await nhl(date):await mlb(date))
     .filter(g=>g.away_code&&g.home_code&&Number.isFinite(Date.parse(g.start_utc))).slice(0,32);
   return respond({sport,date,preview:true,source:sport==="NFL"?"ESPN":sport==="NHL"?"NHL":"MLB",games});
 }catch(e){
   const message=e instanceof Error?e.message:"Provider unavailable";
   console.error("[sports-scores]",JSON.stringify({sport,date,error:message}));
   return respond({sport,date,preview:true,error:message,games:[]},503);
 }
});
