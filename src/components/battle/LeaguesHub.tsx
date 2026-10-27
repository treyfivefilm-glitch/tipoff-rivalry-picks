import { useEffect, useState } from "react";
import { Calendar, Check, ChevronLeft, Crown, Loader2, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { pacificTime, todayPacific, addDays } from "@/lib/time";
import { TeamBadge } from "./TeamBadge";

interface League { id:string; name:string; invite_code:string; owner_id:string; sport:string; created_at:string }
interface LeagueMember { league_id:string; user_id:string; display_name:string }
interface LeagueStanding { user_id:string; display_name:string; correct_count:number; decided_count:number }
interface Game { id:string; start_utc:string; away_code:string; home_code:string; away_name:string; home_name:string; state:string }
interface LeaguePick { game_id:string; user_id:string; team_code:string }

const input = "min-h-12 w-full rounded-xl border border-input bg-background/60 px-4 outline-none focus:border-primary";
const getErr = (err: unknown) => err instanceof Error ? err.message : String(err);

/** Private NBA groups of up to 10, independent of two-player wager rooms. */
export function LeaguesHub() {
  const [leagues,setLeagues] = useState<League[]>([]);
  const [members,setMembers] = useState<LeagueMember[]>([]);
  const [selected,setSelected] = useState<League | null>(null);
  const [standings,setStandings] = useState<LeagueStanding[]>([]);
  const [games,setGames] = useState<Game[]>([]);
  const [picks,setPicks] = useState<LeaguePick[]>([]);
  const [myId,setMyId] = useState<string | null>(null);
  const [name,setName] = useState("");
  const [displayName,setDisplayName] = useState("");
  const [code,setCode] = useState("");
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);

  async function refresh() {
    const [{data:u},{data:lg,error:le},{data:ms,error:me}] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("leagues" as "rooms").select("*").order("created_at",{ascending:false}),
      supabase.from("league_members" as "room_members").select("*"),
    ]);
    if(le) throw le; if(me) throw me;
    setMyId(u.user?.id ?? null);
    setLeagues((lg ?? []) as unknown as League[]);
    setMembers((ms ?? []) as unknown as LeagueMember[]);
  }
  useEffect(() => {
    let mounted = true;
    void refresh().catch(e => { if(mounted) toast.error("Could not load leagues: " + getErr(e)); })
      .finally(() => { if(mounted) setLoading(false); });
    return () => { mounted=false; };
  }, []);

  async function openLeague(league: League) {
    setBusy(true);
    try {
      const from = addDays(todayPacific(), -1) + "T00:00:00Z";
      const to = addDays(todayPacific(), 10) + "T00:00:00Z";
      const [st, gs, ps] = await Promise.all([
        supabase.rpc("get_league_standings" as never, {p_league:league.id} as never),
        supabase.from("games").select("id,start_utc,away_code,home_code,away_name,home_name,state")
          .gte("start_utc",from).lt("start_utc",to).eq("state","scheduled").order("start_utc").limit(80),
        supabase.from("league_picks" as "picks").select("*"),
      ]);
      if(st.error)throw st.error; if(gs.error)throw gs.error; if(ps.error)throw ps.error;
      setSelected(league);
      setStandings((st.data ?? []) as LeagueStanding[]);
      setGames((gs.data ?? []) as Game[]);
      setPicks(((ps.data ?? []) as unknown as LeaguePick[]).filter(p => p.game_id));
    } catch(e) { toast.error(getErr(e)); } finally { setBusy(false); }
  }

  async function callLeague(fn:"create_league"|"join_league", payload: Record<string,string>) {
    if(busy) return;
    setBusy(true);
    try {
      const {data,error}=await supabase.rpc(fn as never,payload as never);
      if(error)throw error;
      await refresh();
      toast.success(fn==="create_league"?"League created":"Joined league");
      const target=leagues.find(x => x.id === data);
      if(target) void openLeague(target);
      setName("");setCode("");
    } catch(e){toast.error(getErr(e));} finally {setBusy(false);}
  }

  async function choose(game: Game, team:string) {
    if(!selected || busy) return;
    setBusy(true);
    try {
      const {error}=await supabase.rpc("make_league_pick" as never, {
        p_league:selected.id,p_game:game.id,p_team:team,
      } as never);
      if(error) throw error;
      if(myId) setPicks(old => [
        ...old.filter(p => !(p.game_id===game.id && p.user_id===myId)),
        {game_id:game.id,user_id:myId,team_code:team},
      ]);
      toast.success(`Picked ${team} · no wager placed`);
    } catch(e){toast.error(getErr(e));} finally {setBusy(false);}
  }

  return (
    <div className="space-y-4">
      {selected ? (
        <>
          <button type="button" className="inline-flex min-h-11 items-center gap-2 font-cond text-sm text-primary" onClick={() => setSelected(null)}>
            <ChevronLeft className="h-4 w-4"/> All leagues
          </button>
          <section className="tipoff-card space-y-2 rounded-2xl p-4">
            <p className="font-cond text-xs tracking-widest text-[#ff882e]">NBA FRIENDS LEAGUE</p>
            <h2 className="font-display text-3xl">{selected.name}</h2>
            <div className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span><Users className="mr-1 inline h-4 w-4" /> {members.filter(m=>m.league_id===selected.id).length}/10 players</span>
              <span>Invite: <b className="text-primary">{selected.invite_code}</b></span>
            </div>
            <button type="button" className="min-h-11 w-full rounded-xl border border-primary/40 bg-primary/10 font-cond text-sm font-bold text-primary"
              onClick={async () => {
                try { await navigator.clipboard.writeText(selected.invite_code); toast.success("League code copied"); }
                catch { toast.error("Copy the invite code shown above."); }
              }}>Copy league invite code</button>
          </section>
          <section className="tipoff-card space-y-2 rounded-2xl p-4">
            <h3 className="flex items-center gap-2 font-display text-2xl"><Trophy className="h-5 w-5 text-[#ff882e]"/> LEAGUE STANDINGS</h3>
            {standings.length===0 && <p className="text-xs text-muted-foreground">No standings yet.</p>}
            {standings.map((r,i)=>(
              <div key={r.user_id} className="flex items-center justify-between border-b border-border/60 py-2 text-sm last:border-0">
                <span className="truncate"><b className="mr-2 font-display text-xl text-primary">{i+1}</b>{r.display_name}{r.user_id===myId?" (you)":""}</span>
                <span className="shrink-0 font-cond">{r.correct_count} wins / {r.decided_count} picks</span>
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <h3 className="font-display text-2xl">MAKE LEAGUE PICKS</h3>
            <p className="text-xs text-muted-foreground">Choose one winner before tipoff. Other members' picks stay hidden until games start. No cash wagers in leagues.</p>
            {games.slice(0,30).map(g=>{
              const mine=picks.find(p=>p.game_id===g.id && p.user_id===myId)?.team_code;
              return <div key={g.id} className="tipoff-card space-y-2 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-cond text-xs text-muted-foreground"><Calendar className="h-3.5 w-3.5"/>{pacificTime(g.start_utc)}</span>
                  {mine && <span className="inline-flex items-center gap-1 font-cond text-xs text-win"><Check className="h-3.5 w-3.5"/> Picked {mine}</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[{code:g.away_code,name:g.away_name},{code:g.home_code,name:g.home_name}].map(t=>(
                    <button type="button" key={t.code} disabled={busy || Date.now()>=Date.parse(g.start_utc)} onClick={()=>void choose(g,t.code)}
                      className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-2 font-cond text-sm font-bold disabled:opacity-50 ${mine===t.code?"border-primary bg-primary/20 text-primary":"border-border bg-background/40"}`}>
                      <TeamBadge code={t.code} size={26}/>{t.code}
                    </button>
                  ))}
                </div>
              </div>
            })}
            {!games.length && <p className="text-sm text-muted-foreground">No upcoming NBA games in the next 10 days.</p>}
          </section>
        </>
      ) : (
        <>
          <section className="tipoff-card space-y-2 rounded-2xl p-4">
            <div className="flex items-center gap-2"><Users className="h-5 w-5 text-primary"/><h2 className="font-display text-3xl">FRIENDS LEAGUES</h2></div>
            <p className="text-xs text-muted-foreground">Private NBA competitions for up to 10 people. Leaderboards track correct winners; friendly wagers are separate in 1-on-1 rooms.</p>
            {loading && <p className="text-sm">Loading leagues…</p>}
            {!loading && leagues.length===0 && <p className="text-sm text-muted-foreground">No leagues yet. Create one or enter an invite code.</p>}
            {leagues.map(league=>(
              <button key={league.id} type="button" disabled={busy} onClick={()=>void openLeague(league)}
                className="flex min-h-16 w-full items-center justify-between gap-2 rounded-xl border border-border bg-background/40 p-3 text-left">
                <div className="min-w-0">
                  <p className="truncate font-cond text-lg font-bold">{league.name}</p>
                  <p className="font-cond text-xs text-muted-foreground">
                    {league.sport} · {members.filter(m=>m.league_id===league.id).length}/10 players
                    {league.owner_id===myId?" · your league":""}
                  </p>
                </div>
                <Crown className="h-5 w-5 shrink-0 text-[#ff882e]"/>
              </button>
            ))}
          </section>
          <section className="tipoff-card space-y-3 rounded-2xl p-4">
            <h3 className="font-display text-2xl">CREATE A LEAGUE</h3>
            <input className={input} value={displayName} onChange={e=>setDisplayName(e.target.value)} maxLength={30} placeholder="Your display name" autoComplete="nickname" />
            <input className={input} value={name} onChange={e=>setName(e.target.value)} maxLength={60} placeholder="League name" />
            <button type="button" disabled={busy||!name.trim()||!displayName.trim()}
              onClick={()=>void callLeague("create_league",{p_name:name,p_display_name:displayName})}
              className="min-h-12 w-full rounded-xl bg-primary font-cond font-bold text-white disabled:opacity-50">
              {busy?<Loader2 className="mx-auto h-5 w-5 animate-spin"/>:"Create NBA league"}
            </button>
          </section>
          <section className="tipoff-card space-y-3 rounded-2xl p-4">
            <h3 className="font-display text-2xl">JOIN A LEAGUE</h3>
            <input className={input} value={code} maxLength={8} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-F0-9]/g,""))}
              placeholder="8-character invite code" autoCapitalize="characters" />
            <input className={input} value={displayName} onChange={e=>setDisplayName(e.target.value)} maxLength={30} placeholder="Your display name" autoComplete="nickname" />
            <button type="button" disabled={busy||code.length!==8||!displayName.trim()} onClick={()=>void callLeague("join_league",{p_code:code,p_display_name:displayName})}
              className="min-h-12 w-full rounded-xl border border-primary/50 font-cond font-bold text-primary disabled:opacity-50">Join league</button>
          </section>
        </>
      )}
    </div>
  );
}
