# StakSuite

Single-page suite: **StockStak** (inventory/POS) + **SweetStak**.

## Files

| File | Description |
|------|-------------|
| `StakSuite.html` | Main application (full) |
| `StakSuite-2.html` | Same build (alias) |
| `StakSuite-clean.html` | Same build (clean local accounts/portals wipe on first open) |
| `firestore.rules` | Fail-closed Firestore Security Rules (candidate — deploy separately) |
| `docs/MEMBERSHIP_PROVISIONING.md` | Admin membership provisioning notes |
| `rules-tests/` | Optional emulator rules tests |

## Local data wipe (this build)

On first load, local company portals and accounts are wiped once (`stak_wipe_accounts_portals_v20260914`).

This does **not** delete Firebase Auth users or Firestore `stak_memberships` / `stak_companies`.

## Deploy rules (operator machine)

```bash
firebase login
firebase use <your-project>
firebase deploy --only firestore:rules
```

## Security notes

- Do not put Admin SDK private keys in this repo.
- Membership is Admin-provisioned only; clients cannot create `stak_memberships`.
- Firebase web API keys in the app are client config, not service-account secrets.

Generated: 2026-09-13 22:02 UTC
