import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { addDays, pacificTime, todayPacific } from "@/lib/time";
export type OtherSport = "NFL" | "MLB" | "NHL";
interface OtherGame { id:string;start_utc:string;away_code:string;away_name:string;
  home_code:string;home_name:string;away_score:number|null;home_score:number|null;state:string;status_detail:string }
interface ResponseData { sport:OtherSport;date:string;preview:boolean;source:string;games:OtherGame[];error?:string }

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
      const {data:user}=await supabase.auth.getUser();
      if(!user.user){setError("Sign in to preview these scores.");return;}
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
    <p className="text-xs text-muted-foreground">{sport} data is supplied by a third-party public feed and may be delayed or temporarily unavailable.</p>
  </section>;
}
