<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Room departures use the authenticated leave_room RPC with a room-row lock, atomic owner transfer and permanently closed invites; no deletion path is provided to preserve history.
- All existing room write RPCs lock and recheck membership before mutation; frozen historical results cannot be corrected after departure to avoid creating uncollectible obligations.
