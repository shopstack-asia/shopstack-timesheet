# 08 — Known Limitations

- No MCP transport server (internal tools only; MCP-ready adapters).
- Intent quality depends on `AI_*` or rule-based heuristics (Thai/English); **writes still require exact keywords**.
- **Custom project creation from Slack is disabled.** Unknown projects are rejected; users must create projects via the existing supported (web) process first. Web submit may still create projects when `allowCustomProject` defaults to true.
- Leave `ApprovalStatus` still not filtered (same as web).
- Server still does not enforce leave; agent refuses FULL leave unless `OVERRIDE`, then still needs `YES`.
- No approval / reporting / other-employee access.
- Slack email visibility required for identity.
- Master project/task lists are global (no assignment filter) — same as web APIs.
- Upsert-before-delete reduces partial-delete risk but is not a multi-row Sheets transaction; compensating restore runs if delete fails after upsert.
- Claim lock TTL must outlive a stuck `executing` write; a crash can leave a short window where re-claim is blocked until claim TTL expires.
