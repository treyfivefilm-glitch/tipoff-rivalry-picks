/** Invitation links contain only the room's six-character invite code.
 * Invite codes grant a chance to request membership, not access to member data.
 */
export function normalizeInviteCode(input: string): string {
  return input.trim().toUpperCase();
}
export function isValidInviteCode(input: string): boolean {
  return /^[A-F0-9]{6}$/.test(normalizeInviteCode(input));
}
export function battleInviteUrl(origin: string, code: string): string {
  const normalized = normalizeInviteCode(code);
  if (!isValidInviteCode(normalized)) throw new Error("Invalid invite code");
  const url = new URL(origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("Invitations require a secure site");
  }
  return new URL(`/join/${normalized}`, url.origin).href;
}
export function battleInviteMessage(name: string): string {
  const safeName = name.trim().slice(0, 60) || "my NBA Pick Battle";
  return `Join me in ${safeName} on TIPOFF Rivalry Picks! Pick NBA winners and see who's better.`;
}
