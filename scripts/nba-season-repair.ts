import { createClient } from "@supabase/supabase-js";
const url=process.env["SUPABASE_URL"]; const key=process.env["SUPABASE_PUBLISHABLE_KEY"];
if (!url || !key) throw new Error("Missing public Supabase project config");
const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const {data:auth,error:ae}=await supabase.auth.signInAnonymously();
if(ae||!auth.session) throw new Error("Anonymous smoke user unavailable: "+ae?.message);
let day=new Date("2026-10-20T00:00:00Z");
const end="2027-04-11",days=[];
while (day.toISOString().slice(0,10)<=end) {
  days.push(day.toISOString().slice(0,10));
  day=new Date(day.getTime()+86400000);
}
let total=0;
for(let i=0;i<days.length;i+=21) {
  const block=days.slice(i,i+21);
  const {data,error}=await supabase.functions.invoke("sync-games",{body:{days:block,force:true}});
  if (error || !data || data.errors?.length) throw new Error("Batch "+i+": "+(error?.message||JSON.stringify(data?.errors)));
  total+=data.updated||0;
  console.log("Days",i+1,"-",Math.min(i+21,days.length),"checked",data.checked,"saved",data.updated);
}
const {count,error:dbError}=await supabase.from("games").select("id",{head:true,count:"exact"});
if(dbError)throw dbError;
console.log("Imported "+days.length+" season days, "+total+" game row updates, "+count+" total stored NBA games.");
if((count??0)<1000)throw new Error("Season inventory unexpectedly small; investigate before release");
const { count: broken, error: brokenErr } = await supabase.from("games")
  .select("id", { head:true, count:"exact" })
  .lt("start_utc","2026-01-01T00:00:00Z");
if (brokenErr) throw new Error("Date audit failed: " + brokenErr.message);
console.log("Invalid historic tipoffs remaining:", broken);
if ((broken ?? 0) > 0) throw new Error("Future schedule still has 1900 placeholder tipoffs; cannot release");
const { count: future, error: futureErr } = await supabase.from("games")
  .select("id",{head:true,count:"exact"})
  .gte("start_utc","2026-11-01T00:00:00Z").eq("state","scheduled");
if (futureErr) throw futureErr;
console.log("Upcoming November-or-later NBA games:", future);
if ((future ?? 0) < 100) throw new Error("Not enough real future games imported");
await supabase.auth.signOut();
