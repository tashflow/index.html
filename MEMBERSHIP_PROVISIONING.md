# Membership provisioning

## Callables (functions/index.js)

| Name | Purpose |
|------|---------|
| `bootstrapCompanyOwner` | Owner membership when companyId matches normalized Auth email |
| `provisionStaffMembership` | Supervisor provisions staff by email |
| `setMembershipActive` | Activate / deactivate |
| `fbVerifyMembership` | Server-side membership check |

Path: `stak_memberships/{AUTH_UID}` → `apps.stockstak`

## Deploy

```powershell
cd functions
npm install
npm test
cd ..
firebase use stak-suite
firebase deploy --only functions
```
