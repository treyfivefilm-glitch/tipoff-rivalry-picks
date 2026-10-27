import { createClient } from "@supabase/supabase-js";
const url=process.env["SUPABASE_URL"],key=process.env["SUPABASE_PUBLISHABLE_KEY"];
if(!url||!key)throw Error("Missing public configuration");
const client=createClient(url,key,{auth:{persistSession:false}});
const totals=await client.from("games").select("id",{head:true,count:"exact"});
const invalid=await client.from("games").select("id",{head:true,count:"exact"}).lt("start_utc","2026-01-01T00:00:00Z");
const future=await client.from("games").select("id",{head:true,count:"exact"})
  .gte("start_utc","2026-11-01T00:00:00Z").eq("state","scheduled");
for(const x of [totals,invalid,future])if(x.error)throw x.error;
console.log("NBA INTEGRITY:",JSON.stringify({total:totals.count,invalidDates:invalid.count,futureGames:future.count}));
if((totals.count??0)<1100||(invalid.count??0)!==0||(future.count??0)<100)
  throw Error("NBA schedule failed validity checks: investigate before promotion");
