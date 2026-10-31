import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { addDays, pacificTime, todayPacific } from "@/lib/time";
export type OtherSport = "NFL" | "MLB" | "NHL";
interface OtherGame { id:string;start_utc:string;away_code:string;away_name:string;
  home_code:string;home_name:string;away_score:number|null;home_score:number|null;state:string;status_detail:string }
interface ResponseData { sport:OtherSport;date:string;preview:boolean;source:string;games:OtherGame[];error?:string }

type EspnTeam = { homeAway:string; score?:string; team:{ abbreviation:string; displayName:string } };
type EspnEvent = { id:string; date:string; status:{type:{state:string;shortDetail:string}};
  competitions:Array<{competitors:EspnTeam[]}> };
async function nflFromBrowser(date:string):Promise<OtherGame[]> {
  // ESPN supports direct browser scoreboard requests; its server-side CDN
  // often blocks requests from Supabase's Edge runtime.
  const response=await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date.replaceAll("-","")}`,
    {signal:AbortSignal.timeout(10000)}
  );
  if(!response.ok)throw new Error("NFL scoreboard temporarily unavailable");
  const raw=await response.json() as {events?:EspnEvent[]};
  return (raw.events??[]).flatMap(e=>{
    const teams=e.competitions?.[0]?.competitors??[];
    const away=teams.find(t=>t.homeAway==="away"),home=teams.find(t=>t.homeAway==="home");
    if(!away||!home)return [];
    const state=e.status?.type?.state==="post"?"final":e.status?.type?.state==="in"?"live":"scheduled";
    const score=(value:string|undefined)=>value!==undefined&&Number.isFinite(Number(value))?Number(value):null;
    return [{id:"nfl:"+e.id,start_utc:e.date,away_code:away.team.abbreviation,away_name:away.team.displayName,
      home_code:home.team.abbreviation,home_name:home.team.displayName,
      away_score:state==="scheduled"?null:score(away.score),home_score:state==="scheduled"?null:score(home.score),
      state,status_detail:e.status.type.shortDetail}];
  });
}

export function SportsPreview({ sport }: { sport: OtherSport }) {
  const [day,setDay]=useState(todayPacific);
  const [games,setGames]=useState<OtherGame[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    let active=true;
    setLoading(true);
    setError(null);
    const load=async()=>{
      if(sport==="NFL"){
        const nfl=await nflFromBrowser(day);
        if(active)setGames(nfl);
        return;
      }
      const {data:user}=await supabase.auth.getUser();
      if(!user.user){setError("Sign in to preview MLB and NHL scores.");return;}
      const {data,error:upstream}=await supabase.functions.invoke("sports-scores",{
        body:{sport,date:day}
      });
      if(upstream)throw upstream;
      const result=data as ResponseData;
      if(result.error)throw new Error(result.error);
      if(!active)return;
      setGames(result.games??[]);
    };
    void load().catch(e=>{if(active){setGames([]);setError(e instanceof Error?e.message:"Feed unavailable");}})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[sport,day,reload]);
  const live=games.filter(g=>g.state==="live").length;
  return <section className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <div><h2 className="font-display text-3xl">{sport} SCOREBOARD</h2>
        <p className="font-cond text-xs text-muted-foreground">Read-only preview · No {sport} picks or wagers yet</p>
      </div>
      <button type="button" aria-label="Refresh scores" onClick={()=>setReload(n=>n+1)} className="grid h-11 w-11 place-items-center rounded-xl border border-border text-primary">
        <RefreshCw className={loading?"h-5 w-5 animate-spin":"h-5 w-5"}/>
      </button>
    </div>
    <div className="grid grid-cols-[48px_1fr_48px] items-center rounded-xl border border-border bg-card/60 text-center">
      <button aria-label="Previous date" type="button" className="grid h-12 place-items-center" onClick={()=>setDay(d=>addDays(d,-1))}><ChevronLeft className="h-5 w-5"/></button>
      <div className="font-cond text-sm font-bold">{day} · {live} live</div>
      <button aria-label="Next date" type="button" className="grid h-12 place-items-center" onClick={()=>setDay(d=>addDays(d,1))}><ChevronRight className="h-5 w-5"/></button>
    </div>
    {loading && <p className="tipoff-card rounded-xl p-5 text-center text-sm text-muted-foreground">Loading {sport} games…</p>}
    {error && <p className="rounded-xl border border-loss/50 bg-loss/10 p-4 text-sm text-loss">{error}</p>}
    {!loading&&!error&&games.length===0 && <p className="tipoff-card rounded-xl p-5 text-center text-sm text-muted-foreground">No {sport} games on this date.</p>}
    {!loading&&!error&&games.map(g=>(
      <article key={g.id} className="tipoff-card rounded-xl p-3">
        <div className="mb-2 flex justify-between font-cond text-[11px] text-muted-foreground">
          <span>{pacificTime(g.start_utc)}</span>
          <span className={g.state==="live"?"font-bold text-loss":"uppercase"}>{g.status_detail||g.state}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 font-cond text-sm">
          <div className="truncate font-bold">{g.away_name||g.away_code}</div>
          <div className="font-display text-xl tabular-nums">{g.away_score??"—"}</div>
          <div className="truncate font-bold">{g.home_name||g.home_code}</div>
          <div className="font-display text-xl tabular-nums">{g.home_score??"—"}</div>
        </div>
      </article>
    ))}
    <p className="text-xs text-muted-foreground">{sport} data is supplied by a public provider feed and may be delayed or temporarily unavailable. NFL uses ESPN’s unofficial browser API.</p>
  </section>;
}
