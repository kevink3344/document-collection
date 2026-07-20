# Plan: Add Location Assignment to "Add New User"

## Overview

The **Add New User** form in Settings currently collects:
- Name
- Email
- Access (role)
- Memberships (organizations + roles)

Locations can only be assigned after the user is created, by editing the existing user. This plan adds an optional **Locations** section to the new-user form so administrators can assign locations at creation time.

---

## Current State

### Client — `client/src/pages/SettingsPage.tsx`

- The new-user form is rendered inside the `users` panel (around line 3350).
- State for the form:
  - `newUserName`
  - `newUserEmail`
  - `newUserRole`
  - `newUserMemberships`
- `handleCreateUser()` calls `createUser()` from `client/src/api/users.ts` with `name`, `email`, `role`, and `memberships`.
- Locations are managed separately in the edit-user sidebar via:
  - `editingUserLocations`
  - `getUserLocations(userId)`
  - `updateUserLocations(userId, locationIds)`
- Location assignment is currently only shown for users whose membership role includes `reviewer` (existing logic loads locations only when `u.role === 'reviewer'`).

### Server — `server/src/routes/users.ts`

- `POST /api/users` creates a user and persists memberships, but does **not** accept or persist `locationIds`.
- `PUT /api/users/:id/locations` already exists to set locations for an existing user.
- `GET /api/users/:id/locations` returns the locations assigned to a user.

---

## Desired Behaviour

- The **Add New User** form gains an optional **Locations** section.
- Locations are shown as removable tags with a typeahead to add more.
- Locations are optional: a new user can be created with zero locations.
- The existing restriction logic should be respected: location assignment makes the most sense for reviewers, but the UI can allow it for any non-super-admin role (same as edit-user sidebar).
- On submit, the client first calls `createUser()`, then calls `updateUserLocations(created.id, selectedLocationIds)` if at least one location was selected.
- After successful creation, the form resets and the user list reloads.

---

## Implementation Plan

### A. Client — `client/src/pages/SettingsPage.tsx`

1. **Add state for new-user locations**
   ```tsx
   const [newUserLocations, setNewUserLocations] = useState<Location[]>([])
   ```

2. **Reset state on successful creation and when canceling**
   - Reset `newUserLocations` to `[]` inside `handleCreateUser()` after success.
   - Also clear it if a "Cancel" / reset action is added.

3. **Add a Locations section to the new-user form**
   Insert a new block in the new-user form grid, below Memberships, with the same pattern used in the edit-user sidebar:
   - Heading: **Locations** (optional)
   - Helper text: *"Limit which submissions this user can see based on location."*
   - Render selected locations as removable teal tags.
   - Use `<LocationTypeahead />` with `value={null}` and `onChange` to append unique locations to `newUserLocations`.
   - Show only for non-super-admin roles (mirrors edit-user sidebar).

4. **Update `handleCreateUser()`**
   - After `await createUser(...)`, if the user is not a super admin and `newUserLocations.length > 0`:
     ```tsx
     await updateUserLocations(created.id, newUserLocations.map(l => l.id))
     ```
   - Wrap the location update in a try/catch so a location-save failure does not roll back the user creation; show a non-blocking warning instead.
   - Reset `newUserLocations` on success.

5. **Validation considerations**
   - No validation required for locations (optional).
   - Existing membership and role validation remains unchanged.

### B. Server — `server/src/routes/users.ts` (optional enhancement)

The current two-step client approach (`createUser` + `updateUserLocations`) is acceptable and reuses existing endpoints. However, for atomicity, the server could be updated to accept `locationIds` in `POST /api/users`:

1. Accept `locationIds?: number[]` in the request body.
2. Validate that each location exists and belongs to the same organization(s) as the user's memberships.
3. Insert rows into `user_locations` within the same transaction used for `persistMemberships`.

**Recommendation:** Start with the client-only two-step approach to minimize risk and reuse the existing `PUT /api/users/:id/locations` endpoint. If atomicity becomes important later, move location assignment into the create endpoint.

### C. API client — `client/src/api/users.ts`

No change required if using the two-step approach. If the server endpoint is extended to accept `locationIds`, update the `createUser` payload type:

```ts
export async function createUser(payload: {
  name: string
  email: string
  role?: UserRole
  organizationId?: number
  memberships?: UserMembershipPayload[]
  locationIds?: number[]
}): Promise<AppUser>
```

---

## Files Affected

| File | Change |
|---|---|
| `client/src/pages/SettingsPage.tsx` | Add `newUserLocations` state, locations UI in new-user form, and location save call in `handleCreateUser()` |
| `client/src/api/users.ts` | Optional: add `locationIds` to `createUser` payload type |
| `server/src/routes/users.ts` | Optional: accept and persist `locationIds` during user creation |

---

## UX Flow

```
Settings → Users → Add New User
  Name: [Jane Smith]
  Email: [jane@example.com]
  Access: [Organization Member ▼]
  Memberships: [Org A | User | Default] [Remove]
                [+ Add membership]
  Locations:   [Central High School] [×]
               [West Middle School] [×]
               [Search locations…]
  [Create User]
```

After clicking **Create User**:
1. User is created.
2. Locations are assigned (if any).
3. Form resets.
4. User list updates and shows the new user.

---

## Open Questions

1. **Role scoping:** Should the Locations section be shown only for `reviewer` roles, or for any non-super-admin user? The edit-user sidebar currently shows it for any non-super-admin once saved (but only loads existing locations when `u.role === 'reviewer'`).
2. **Atomicity:** Should location assignment be part of the `POST /api/users` transaction, or is the two-step client approach acceptable?
3. **Organization filtering:** Should the location typeahead be filtered to only locations belonging to the user's selected organization(s)? Currently `searchLocations` returns all locations the admin can see.
4. **Super admins:** Super admins currently have global access and no locations. Should this remain true?
