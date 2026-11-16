# Stillpoint Firestore Security Specification

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document under `/users/{userId}` and its subcollections (`maps`, `nodes`, `edges`, `dumps`, `patterns`) belongs exclusively to `userId == request.auth.uid`. No user may read, list, create, update, or delete another user's data.
2. **PII Protection**: `users/{userId}` holds `email` and is readable/writable only by the verified owner (`isOwner(userId)`).
3. **Master Gate Consistency**: Every subcollection document (`nodes`, `edges`, `dumps`, `patterns`) under `/users/{userId}/maps/{mapId}` must match `mapId == data.mapId` and `ownerId == request.auth.uid`, and on `create` must verify via `get()` that the parent `/users/{userId}/maps/{mapId}` exists and is owned by `request.auth.uid`.
4. **Immutable Ownership & Provenance**: `uid`, `id`, `ownerId`, `mapId`, and `createdAt` cannot be modified after creation.
5. **Temporal Integrity**: `createdAt` must equal `request.time` on `create`, and `updatedAt` must equal `request.time` on both `create` and `update`.
6. **Strict Schema & Bounds**: Every string field has strict `.size()` caps, IDs match `^[a-zA-Z0-9_\-]+$`, enums are allowlisted, coordinates and priority orders are bounded numbers, and `relatedNodeIds` is capped at 20 strings.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Fail with PERMISSION_DENIED)
1. **Cross-Tenant Read**: User B attempts `get(/users/userA/maps/map1)`.
2. **Cross-Tenant List**: User B attempts `list(/users/userA/maps/map1/nodes)`.
3. **Identity Spoofing on Create**: User A attempts to create `/users/userA/maps/map1` with `ownerId: "userB"`.
4. **Shadow Ghost Field**: User A attempts to create `/users/userA/maps/map1/nodes/n1` with extra field `isAdmin: true`.
5. **Unverified Email Write**: User A with `email_verified: false` attempts to create a brain dump.
6. **Orphaned Node Creation**: User A attempts to create `/users/userA/maps/nonexistentMap/nodes/n1`.
7. **Immutable Field Tampering**: User A attempts to update `ownerId` or `createdAt` on an existing node.
8. **Timestamp Forgery**: User A attempts to create a map with `createdAt` backdated instead of `request.time`.
9. **ID Poisoning**: User A attempts to create a node with document ID containing invalid characters (`../evil` or 200-char string).
10. **Payload Exhaustion**: User A attempts to write a 10,000-char `rawText` into `dumps`.
11. **Invalid Enum Injection**: User A attempts to update `priorityTier: "urgent_hack"` on a node.
12. **Unbounded Array / Wrong Type**: User A attempts to create a pattern with `relatedNodeIds` containing 25 items or a non-string first item.
