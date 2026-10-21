// Team primary/secondary colors for original lettermark badges (no official logos used).
export const TEAM_COLORS: Record<string, [string, string]> = {
  ATL: ["#C8102E", "#FDB927"], BOS: ["#007A33", "#BA9653"], BKN: ["#1b1b1b", "#FFFFFF"], CHA: ["#1D1160", "#00788C"],
  CHI: ["#CE1141", "#1b1b1b"], CLE: ["#860038", "#FDBB30"], DAL: ["#00538C", "#B8C4CA"], DEN: ["#0E2240", "#FEC524"],
  DET: ["#C8102E", "#1D42BA"], GSW: ["#1D428A", "#FFC72C"], HOU: ["#CE1141", "#C4CED4"], IND: ["#002D62", "#FDBB30"],
  LAC: ["#C8102E", "#1D428A"], LAL: ["#552583", "#FDB927"], MEM: ["#5D76A9", "#12173F"], MIA: ["#98002E", "#F9A01B"],
  MIL: ["#00471B", "#EEE1C6"], MIN: ["#0C2340", "#78BE20"], NOP: ["#0C2340", "#C8102E"], NYK: ["#006BB6", "#F58426"],
  OKC: ["#007AC1", "#EF3B24"], ORL: ["#0077C0", "#C4CED4"], PHI: ["#006BB6", "#ED174C"], PHX: ["#1D1160", "#E56020"],
  POR: ["#E03A3E", "#1b1b1b"], SAC: ["#5A2D81", "#63727A"], SAS: ["#1b1b1b", "#C4CED4"], TOR: ["#CE1141", "#1b1b1b"],
  UTA: ["#002B5C", "#F9A01B"], WAS: ["#002B5C", "#E31837"],
};
export function teamColors(code: string): [string, string] {
  return TEAM_COLORS[code] ?? ["#2a3158", "#8b93c7"];
}
export function shortName(full: string): string {
  const parts = full.split(" ");
  if (full.startsWith("Portland")) return "Trail Blazers";
  return parts[parts.length - 1];
}
