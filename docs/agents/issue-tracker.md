# Issue tracker

Issues currently use local Markdown because this repository has no remote. Wayfinding maps and tickets live under `.scratch/` until a GitHub remote is configured.

## Wayfinding operations

- A map is `.scratch/<effort>/map.md`.
- Child tickets are `.scratch/<effort>/tickets/<ticket-name>.md`.
- Ticket front matter records `status`, `assignee`, `type`, and `blocked_by` ticket names.
- The frontier is every open ticket with no assignee and no open ticket named by `blocked_by`.
- Claim a ticket by setting `assignee` before work.
- Resolve a ticket by appending `## Resolution`, setting `status: closed`, and linking its gist from the map.
