# HLD — Optional Peer Dependency Loading Fix

## 1. `helpers/dbError.helper.ts`

**What changed:** Removed the top-level `import ... from 'sequelize'`. Sequelize error classes are now loaded lazily via `requireOptionalPeer<SequelizeErrorClasses>('sequelize', ...)`, only at the point DB-error mapping actually runs.

**Why:** This file is wired into the package's main `index.ts` barrel. A top-level import is resolved the moment anything imports the package — so any consumer without `sequelize` installed crashed at startup just from importing `@fusionxglobal/shared-config`, even if it never touches DB features.


## 2. `clients/http.client.ts`

**What changed:** Replaced the literal `require('axios')` with `requireOptionalPeer<typeof import('axios')>('axios', 'createHttpClient')`.

**Why:** `esbuild` statically resolves literal `require("...")` calls at bundle time and fails the whole build if that module isn't installed — even though the call was runtime-conditional and would never execute for a consumer that doesn't use the HTTP client. Routing through `requireOptionalPeer` (which takes the module name as a variable, not a literal) makes it esbuild-safe.


## 3. `grpc/base.client.ts`

**What changed:** Replaced the literal `require('@grpc/grpc-js')` and `require('@grpc/proto-loader')` calls with `requireOptionalPeer(...)` calls, one per module.

**Why:** Same esbuild static-resolution problem as #2 — any consumer without gRPC installed failed its build the moment this file was bundled, regardless of whether gRPC was actually used.

## 4. `grpc/server.ts`

**What changed:** Same substitution as #3, applied to the server-side gRPC bootstrap path.

**Why:** Same reasoning as #3 — the server bootstrap had the identical literal-`require()` pattern for the same two modules.

---
*More points can be added here as further changes land in this package.*
