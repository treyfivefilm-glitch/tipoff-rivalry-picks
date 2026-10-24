import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarDays, HandCoins, History, Trophy } from "lucide-react";
import { LiveBattle } from "@/lib/battle-live";
import { Shell, SettingsIcon, tabClass } from "@/components/battle/Shell";
import { GamesTab } from "@/components/battle/GamesTab";
import { StandingsTab } from "@/components/battle/StandingsTab";
import { HistoryTab } from "@/components/battle/HistoryTab";
import { SettingsTab } from "@/components/battle/SettingsTab";
import { WagerCenter, useWagerAttention } from "@/components/battle/WagerCenter";

export const Route = createFileRoute("/_authenticated/room/$id")({
  head: () => ({
    meta: [
      { title: "Room · NBA Pick Battle" },
      { name: "description", content: "Your private head-to-head pick battle room." },
      { property: "og:title", content: "NBA Pick Battle room" },
      { property: "og:description", content: "Your private head-to-head pick battle room." },
    ],
  }),
  component: RoomPage,
});

function RoomPage() {
  const { id } = Route.useParams();
  return (
    <LiveBattle roomId={id}>
      <RoomInner />
    </LiveBattle>
  );
}

type Tab = "games" | "wagers" | "standings" | "history" | "settings";

function RoomInner() {
  const [tab, setTab] = useState<Tab>("games");
  const attention = useWagerAttention();
  return (
    <Shell
      settingsLink={
        <button type="button" aria-label="Settings" onClick={() => setTab(tab === "settings" ? "games" : "settings")}>
          <SettingsIcon />
        </button>
      }
      tabs={
        <>
          <button type="button" data-status={tab === "games" ? "active" : undefined} className={tabClass} onClick={() => setTab("games")}>
            <CalendarDays className="h-5 w-5" /> Games
          </button>
          <button type="button" data-status={tab === "wagers" ? "active" : undefined} className={cn(tabClass, "relative")} onClick={() => setTab("wagers")}>
            <HandCoins className="h-5 w-5" /> Wagers
            {attention > 0 && (
              <span className="absolute right-2 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-loss px-1 text-[9px] font-bold text-white">
                {attention}
              </span>
            )}
          </button>
          <button type="button" data-status={tab === "standings" ? "active" : undefined} className={tabClass} onClick={() => setTab("standings")}>
            <Trophy className="h-5 w-5" /> Standings
          </button>
          <button type="button" data-status={tab === "history" ? "active" : undefined} className={tabClass} onClick={() => setTab("history")}>
            <History className="h-5 w-5" /> History
          </button>
        </>
      }
    >
      {tab === "games" && <GamesTab />}
      {tab === "wagers" && <WagerCenter />}
      {tab === "standings" && <StandingsTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "settings" && <SettingsTab />}
    </Shell>
  );
}
