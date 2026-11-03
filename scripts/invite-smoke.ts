import { createClient } from "@supabase/supabase-js";
import { battleInviteUrl, normalizeInviteCode } from "../src/lib/invites";
const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_PUBLISHABLE_KEY"];
if (!url || !key) throw new Error("Test project missing");
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = client(), friend = client(), outsider = client();
for (const [label, c] of [["owner", owner], ["friend", friend], ["outsider", outsider]] as const) {
  const {error} = await c.auth.signInAnonymously();
  if (error) throw new Error(label + " guest sign-in: " + error.message);
}
const prefix="__TIPOFF_TEST_INVITE__";
const {data:roomId,error:made} = await owner.rpc("create_room", {
  p_name: prefix + Date.now().toString(36),p_display_name:"Test host"
});
if (made || !roomId) throw new Error("Could not create test battle: "+made?.message);
const {data:room,error:re} = await owner.from("rooms").select("id,invite_code").eq("id",roomId).single();
if (re || !room || !room.invite_code) throw new Error("Owner cannot read invite code");
const link=battleInviteUrl("https://tipoff-rivalry-picks-independent.vercel.app",room.invite_code);
if(!link.endsWith("/join/"+normalizeInviteCode(room.invite_code)))throw new Error("Malformed share URL");
const {data:joinId,error:joinError}=await friend.rpc("join_room",{
  p_code:room.invite_code.toLowerCase(),p_display_name:"Test friend"
});
if (joinError || joinId !== roomId) throw new Error("Second player failed joining: "+joinError?.message);
const {data:repeat,error:repeatErr}=await friend.rpc("join_room",{
  p_code:room.invite_code,p_display_name:"Test friend"
});
if (repeatErr || repeat!==roomId) throw new Error("Existing member cannot reopen battle");
const {data:thirdId,error:thirdError}=await outsider.rpc("join_room",{
  p_code:room.invite_code,p_display_name:"Third player"
});
if(!thirdError || thirdId) throw new Error("Full-room limit not enforced");
const {data:members,error:me}=await owner.from("room_members").select("user_id").eq("room_id",roomId);
if(me || members?.length!==2)throw new Error("Expected exactly two players");
const {data:outsiderRooms,error:pe}=await outsider.from("rooms").select("id").eq("id",roomId);
if(pe || outsiderRooms?.length)throw new Error("Outsider can read private battle");
console.log("INVITE FLOW PASS",JSON.stringify({id:roomId,linkFormat:true,members:members.length,idempotentJoin:true,thirdRejected:true,outsiderHidden:true}));
