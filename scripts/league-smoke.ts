import { createClient } from "@supabase/supabase-js";
const url=process.env["SUPABASE_URL"], key=process.env["SUPABASE_PUBLISHABLE_KEY"];
if(!url||!key) throw new Error("Missing smoke-test configuration");
const client=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const a=client(),b=client(),outsider=client();
for(const [who,c] of [["owner",a],["friend",b],["outsider",outsider]] as const) {
  const {error}=await c.auth.signInAnonymously();
  if(error)throw new Error(`${who} sign-in: ${error.message}`);
}
const name="__TIPOFF_TEST_LEAGUE__"+Date.now().toString(36);
const {data:leagueId,error:ce}=await a.rpc("create_league",{p_name:name,p_display_name:"Test owner"});
if(ce||!leagueId)throw new Error("Create league failed: "+ce?.message);
const {data:before,error:preErr}=await b.from("leagues").select("*").eq("id",leagueId);
if(preErr||before?.length)throw new Error("Private league visible before joining");
const {data:owned,error:oe}=await a.from("leagues").select("*").eq("id",leagueId).single();
if(oe||!owned?.invite_code)throw new Error("Owner cannot read their league");
const {error:joinError}=await b.rpc("join_league",{p_code:owned.invite_code,p_display_name:"Test friend"});
if(joinError)throw new Error("Friend join failed: "+joinError.message);
const {data:members,error:me}=await b.from("league_members").select("*").eq("league_id",leagueId);
if(me||members?.length!==2)throw new Error("Expected two league members");
const {error:outsiderError}=await outsider.rpc("get_league_standings",{p_league:leagueId});
if(!outsiderError)throw new Error("Outsider should not view league standings");
const {data:games,error:ge}=await a.from("games").select("id,start_utc,away_code,home_code").eq("state","scheduled")
  .gt("start_utc",new Date(Date.now()+3600000).toISOString()).order("start_utc").limit(1);
if(ge||!games?.length)throw new Error("No future game available to test league picks");
const game=games[0];
const {error:pickErr}=await a.rpc("make_league_pick",{p_league:leagueId,p_game:game.id,p_team:game.away_code});
if(pickErr)throw new Error("Owner pick failed: "+pickErr.message);
const {data:friendView,error:friendRead}=await b.from("league_picks").select("*").eq("league_id",leagueId);
if(friendRead||friendView?.length)throw new Error("Friend can see private pick before tipoff");
const {data:ownerView,error:ownerRead}=await a.from("league_picks").select("*").eq("league_id",leagueId);
if(ownerRead||ownerView?.length!==1)throw new Error("Owner cannot view own pick");
const {error:invalid}=await b.rpc("make_league_pick",{p_league:leagueId,p_game:game.id,p_team:"INVALID"});
if(!invalid)throw new Error("Invalid team was accepted");
const {data:score,error:scoreError}=await a.rpc("get_league_standings",{p_league:leagueId});
if(scoreError||score?.length!==2)throw new Error("Standings not returned for both members");
console.log("LEAGUE SECURITY PASS:",JSON.stringify({leagueId,privacy:"private before tipoff",members:members.length,standings:score.length,invalidTeamRejected:true}));
await Promise.all([a.auth.signOut(),b.auth.signOut(),outsider.auth.signOut()]);
