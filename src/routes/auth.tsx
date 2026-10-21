import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({ redirect: typeof s["redirect"] === "string" && s["redirect"].startsWith("/") && !s["redirect"].startsWith("//") ? s["redirect"] : undefined }),
  head: () => ({ meta: [{ title: "Sign in · NBA Pick Battle" }, { name: "description", content: "Sign in to your private NBA Pick Battle room." }, { property: "og:title", content: "Sign in · NBA Pick Battle" }, { property: "og:description", content: "Sign in to your private pick battle." }] }),
  component: AuthPage,
});

const input = "h-12 w-full rounded-xl border border-input bg-background/60 px-4 outline-none focus:border-primary";

function AuthPage() {
  const { redirect } = Route.useSearch();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const done = () => nav({ href: redirect ?? "/rooms" });

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault(); setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error; done();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin + (redirect ?? "/rooms") } });
        if (error) throw error;
        if (data.session) done(); else toast.success("Check your email to confirm your account.");
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); } finally { setBusy(false); }
  }
  async function forgot() {
    if (!email) { toast.error("Enter your email first"); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) toast.error(error.message); else toast.success("Reset link sent");
  }
  async function google() {
    if (redirect) sessionStorage.setItem("pb-redirect", redirect);
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) toast.error(String(r.error)); else if (!r.redirected) done();
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-6xl leading-none text-primary">PICK BATTLE</h1>
      <p className="text-muted-foreground">{mode === "in" ? "Welcome back." : "Create your account."}</p>
      <form onSubmit={submit} className="space-y-3">
        <input className={input} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" required minLength={6} placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button variant="gold" size="xl" className="w-full" disabled={busy}>{mode === "in" ? "Sign in" : "Sign up"}</Button>
      </form>
      <Button variant="glass" size="xl" onClick={google}>Continue with Google</Button>
      <div className="flex justify-between text-sm">
        <button className="text-primary" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "New here? Sign up" : "Have an account? Sign in"}</button>
        <button className="text-muted-foreground" onClick={forgot}>Forgot password</button>
      </div>
    </div>
  );
}
