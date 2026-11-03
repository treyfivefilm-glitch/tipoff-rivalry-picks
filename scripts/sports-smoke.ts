import { createClient } from "@supabase/supabase-js";
const url=process.env["SUPABASE_URL"],key=process.env["SUPABASE_PUBLISHABLE_KEY"];
if(!url||!key)throw new Error("Missing smoke configuration");
const api=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const {error:signIn}=await api.auth.signInAnonymously();
if(signIn)throw signIn;
let good=0;
for(const [sport,date] of [["NFL","2026-10-25"],["MLB","2026-10-26"],["NHL","2026-10-26"]] as const){
 const {data,error}=await api.functions.invoke("sports-scores",{body:{sport,date}});
 if(error){console.log("FEED ERROR",sport,error.message);continue;}
 if(data.error){console.log("FEED ERROR",sport,data.error);continue;}
 if(!Array.isArray(data.games))throw Error("Malformed sports feed for "+sport);
 console.log("FEED RESULT",sport,"games",data.games.length,
   "sample",JSON.stringify(data.games[0]??{}).slice(0,240));
 good++;
}
console.log("Verified providers:",good,"of 3");
if(good<2)throw Error("Need at least two working additional sports");
await api.auth.signOut();
