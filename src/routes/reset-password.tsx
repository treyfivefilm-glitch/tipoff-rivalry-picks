import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password · NBA Pick Battle" }, { name: "description", content: "Set a new password." }, { property: "og:title", content: "Reset password" }, { property: "og:description", content: "Set a new password." }] }),
  component: () => {
    const [pw, setPw] = useState("");
    const nav = useNavigate();
    return (
      <form className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6" onSubmit={async (e) => {
        e.preventDefault();
        const { error } = await supabase.auth.updateUser({ password: pw });
        if (error) toast.error(error.message); else { toast.success("Password updated"); nav({ to: "/rooms" }); }
      }}>
        <h1 className="font-display text-4xl text-primary">NEW PASSWORD</h1>
        <input type="password" minLength={6} required className="h-12 rounded-xl border border-input bg-background/60 px-4" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button variant="gold" size="xl">Save</Button>
      </form>
    );
  },
});
