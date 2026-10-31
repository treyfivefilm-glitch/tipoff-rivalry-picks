import { useEffect, useState } from "react";
import { BellRing, BellOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const vapidKey = import.meta.env["VITE_WEB_PUSH_PUBLIC_KEY"] as string | undefined;
const publicVapidReady = typeof vapidKey === "string" && vapidKey.length > 40;
function toBytes(value:string) {
  const b64=value.replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(b64.padEnd(Math.ceil(b64.length/4)*4,"="));
  return Uint8Array.from(raw, char=>char.charCodeAt(0));
}
/** Requests push permission only after an explicit click. Delivery stays
 * disabled until the owner configures VAPID and a protected sender.
 */
export function PushSettings() {
  const [supported,setSupported]=useState<boolean|null>(null);
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const ok=typeof window!=="undefined" && "serviceWorker" in navigator
      && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if(!ok || !publicVapidReady)return;
    void navigator.serviceWorker.getRegistration().then(reg=>reg?.pushManager.getSubscription()).then(sub=>{
      setEnabled(Boolean(sub));
    }).catch(()=>{});
  },[]);
  async function enable() {
    if(!supported||!publicVapidReady||!vapidKey) return;
    setBusy(true);
    try {
      const {data:auth,error:authError}=await supabase.auth.getUser();
      if(authError||!auth.user)throw new Error("Sign in before enabling notifications");
      const permission=await Notification.requestPermission();
      if(permission!=="granted")throw new Error("Notification permission was not granted");
      const reg=await navigator.serviceWorker.register("/sw.js",{scope:"/"});
      await navigator.serviceWorker.ready;
      const prior=await reg.pushManager.getSubscription();
      const subscription=prior??await reg.pushManager.subscribe({
        userVisibleOnly:true,applicationServerKey:toBytes(vapidKey).buffer as ArrayBuffer,
      });
      const keys=subscription.toJSON().keys;
      if(!keys?.['p256dh']||!keys['auth'])throw new Error("Could not save push subscription keys");
      const {error}=await supabase.from("push_subscriptions" as never).upsert({
        endpoint:subscription.endpoint,user_id:auth.user.id,p256dh:keys['p256dh'],auth:keys['auth'],
      } as never,{onConflict:"endpoint"});
      if(error)throw error;
      setEnabled(true);
      toast.success("This device is subscribed. Delivery requires the server push service.");
    }catch(error){toast.error(error instanceof Error?error.message:"Could not enable notifications");}
    finally {setBusy(false);}
  }
  async function disable() {
    setBusy(true);
    try {
      const reg=await navigator.serviceWorker.getRegistration();
      const subscription=await reg?.pushManager.getSubscription();
      if(subscription){
        const {error}=await supabase.from("push_subscriptions" as never).delete().eq("endpoint",subscription.endpoint);
        if(error)throw error;
        await subscription.unsubscribe();
      }
      setEnabled(false);
      toast.success("Push subscription removed");
    }catch(error){toast.error(error instanceof Error?error.message:"Could not disable notifications");}
    finally{setBusy(false);}
  }
  return <section className="tipoff-card space-y-3 rounded-2xl p-4">
    <h2 className="flex items-center gap-2 font-display text-2xl"><BellRing className="h-5 w-5 text-primary" /> PHONE ALERTS</h2>
    <p className="text-sm text-muted-foreground">Get tipoff, wager and result alerts on your phone when the delivery service is connected.</p>
    {supported===false && <p className="text-xs text-[#ffad69]">
      iPhone web push requires TIPOFF installed on your Home Screen using Safari. Other browsers must support web push.
    </p>}
    {!publicVapidReady && <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <ShieldCheck className="h-4 w-4" /> Push delivery is not activated by the server owner yet. In-app alerts still work.
    </p>}
    {supported&&publicVapidReady&&(
      <button type="button" disabled={busy} onClick={()=>void (enabled?disable():enable())}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary/60 bg-primary/10 font-cond font-bold text-primary disabled:opacity-50">
        {enabled?<BellOff className="h-4 w-4"/>:<BellRing className="h-4 w-4"/>}
        {enabled?"Disable phone notifications":"Enable phone notifications"}
      </button>
    )}
    {enabled&&<p className="text-xs text-muted-foreground">Your subscription is saved. Delivery depends on the server notification sender.</p>}
  </section>;
}
