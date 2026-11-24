# inventree-api-rbac-tests

Role-based access control, contract and load tests for the [InvenTree](https://github.com/inventree/InvenTree) REST API.

> ⚠️ The public target is the **InvenTree demo server** (demo.inventree.org), a shared instance. This project is not affiliated with InvenTree. On the public server it sends only safe probes, one at a time. Creates, deletes and load tests run only against a throwaway Docker container in CI.

## 1. What is tested

| Suite | What it checks | Public demo | Docker 1.7.4 (CI) |
| ----- | -------------- | ----------- | ----------------- |
| RBAC matrix | `data/rbac-matrix.csv`: role → endpoint → method → expected status (192 rows) | 72 safe-probe rows | all 192 rows, including real writes |
| Contract | Response bodies validated with AJV against InvenTree's own published OpenAPI schema | `schemas/core`, lenient | `schemas/570`, strict (no undocumented fields) |
| Authentication | anonymous, wrong password, inactive account, account with no roles, token auth | token tests skipped | all |
| User visibility | which user fields an account with no roles can read | ✓ | ✓ |
| Load (k6) | 50 virtual users reading parts for 30 s | never | ✓ |

## 2. Roles

The demo's published accounts. Each one's permissions were read from `GET /api/user/me/roles/` on the public demo on 2026-11-24.

| Account | Permissions |
| ------- | ----------- |
| `allaccess` | view, add, change and delete everywhere (admin: view) |
| `reader` | view only, everywhere |
| `engineer` | parts and categories: full; stock: view; purchase and sales orders: none |
| `noaccess` | none (can log in) |
| `ian` | inactive account, cannot log in |
| `steven` | staff, group "all access"; cannot manage users on 1.7.4 (DOC-001), **Docker only** |
| `admin` | superuser, **Docker only** |

## 3. How the probes stay safe on the public server

InvenTree checks permissions before it validates a body or looks up a record. That makes three probes that reveal the permission without changing anything:

| Probe | Allowed | Denied | Not logged in |
| ----- | ------- | ------ | ------------- |
| `GET <list>?limit=1` | 200 | 403 | 401 |
| `POST <list>` with `{}` | 400 (validation error, nothing created) | 403 | 401 |
| `DELETE <detail>` for id 999999999 | 404 (no such record) | 403 | 401 |

- **No bulk operations:** list endpoints are never sent DELETE, PUT or PATCH, because those act on many records at once.
- **Guarded in code:**
  - the matrix loader refuses a write probe on any public row;
  - the write spec is excluded from the public project;
  - the k6 script refuses to start against the demo.

## 4. Contract schemas

`scripts/extract-schemas.js` builds JSON Schemas from InvenTree's published OpenAPI documents ([inventree/schema](https://github.com/inventree/schema), MIT):

- **`schemas/570/`:** API 570, the version in the pinned Docker image `inventree/inventree:1.7.4`.
- **`schemas/core/`:** only what API 570 and the demo's current API (583 when generated) agree on. This is the version-independent check used against the public demo, which runs a development build.
- **`schemas/errors.json`:** the 400, 401 and 403 error bodies, written by hand because the OpenAPI documents don't describe them.

## 5. Findings

FIND and CONTRACT findings are each pinned by a `test.fail` test, which turns red if InvenTree's behaviour changes. DOC-001 is pinned by the matrix rows that expect the observed 403.

| ID | Finding |
| -- | ------- |
| FIND-001 | An account with **no roles** can list every user and read each one's **email address** and `is_staff`, `is_superuser` and `is_active` flags. Password hashes, tokens and login history are not exposed. Listing users is documented as open to any logged-in user (scope `g:read`). The email addresses and privilege flags go beyond what an account without roles needs. |
| CONTRACT-001 | Timestamps come back as `"2024-07-27 05:08"`, but the schema declares RFC 3339 `date-time`. |
| CONTRACT-002 | Image URLs are relative paths (`/media/part_images/…`), but the schema declares an absolute `uri`. |
| CONTRACT-003 | Decimal fields (`total_price`, `purchase_price`, `pricing_min`, `pricing_max`) come back as JSON numbers, but the schema declares decimal strings. |
| DOC-001 | The schema documents user management (`POST`, `PATCH`, `DELETE /api/user/`) as scope `a:staff`. On 1.7.4 the staff account `steven` (group "all access", admin role: view only) gets **403**; only the superuser can manage users. This is stricter than documented, not looser. The matrix expects the observed 403. |

## 6. Execution evidence

Local run against the public demo, 2026-11-24 (Windows, Node 26, Playwright 1.65.1, one worker):

- **Playwright:** 94 passed, 0 failed, 3 skipped (the token tests, which are Docker only), in 3.5 minutes.
- **RBAC:** all 72 matrix rows returned the expected status. By status: 12 × 200, 4 × 400, 4 × 404, 28 × 403, 24 × 401.
- **Contract, authentication, error-body and user-visibility checks:** all 18 passed.
- **Findings:** all four present.

_Pending: the CI runs (public and Docker, including k6) and the published report._

## 7. Run locally

Local runs target the public demo only. The Docker suite and k6 run in CI.

```bash
npm ci
cp .env.example .env            # fill in the published demo passwords
npx playwright test --project=public
node scripts/build-report.js    # writes site/index.html from results/
```

`npm run schemas` regenerates the schemas from the published OpenAPI documents.

## License

MIT. See [LICENSE](LICENSE).

Dependencies: Playwright (Apache-2.0), AJV and ajv-formats (MIT), csv-parse (MIT), yaml (ISC), dotenv (BSD-2-Clause). Data and schemas: the InvenTree demo dataset and the inventree/schema exports (both MIT).
