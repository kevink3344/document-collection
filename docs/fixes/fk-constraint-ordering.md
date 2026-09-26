# Fix: FK constraint ordering in generated DB script

## Problem
When the user ran `docs/data/collection-schema.sql` in SSMS against
`wcpss-data-collection`, the script failed with many `Msg 547, Level 16`
errors like:

```
Msg 547, ... The INSERT statement conflicted with the FOREIGN KEY
constraint "FK_collection_fields_collection_id". The conflict occurred
in database "wcpss-data-collection", table "dbo.collections", column 'id'.
```

## Root cause
The generator (`server/scripts/generate-full-schema.mjs`) emitted the script in
this order:

```
CREATE TABLE  →  FOREIGN KEY CONSTRAINTS  →  SEED DATA
```

Because the FK constraints were added **before** the seed data, every INSERT
had to already satisfy its foreign keys — i.e. the insert order had to be a
perfect topological sort (parents before children). That topologically correct
order was not actually produced. Two issues caused it:

1. **Self-referencing FK** `FK_collections_source_template_collection_id`
   (`collections → collections`) blocks Kahn's algorithm — `collections` can
   never become "ready" because it is its own parent, so it was emitted last,
   *after* all of its children, which then violated their FKs on insert.
2. The cached `_fk-order.json` was **stale** (45 tables incl. phantom tables
   like `collection_shares`, `notifications`, `saved_export_presets`), so the
   order did not match the real 42-table sandbox.

My earlier verifiers only checked row counts + structure balance, never that
parents load before children — so they all reported "0 mismatches" while SSMS
still failed at runtime. That was a verifier blind spot.

## Fix
1. **Load all seed data FIRST, then add FK constraints.** Reordered the
   generator output to:

   ```
   CREATE TABLE  →  SEED DATA (all tables, any order)  →  FOREIGN KEY CONSTRAINTS
   ```

   Because the FK constraints are added **after** all rows exist, no INSERT can
   ever conflict with a not-yet-satisfied FK. The `WITH CHECK` on the ALTER
   validates the freshly-loaded rows — always safe, since the data was copied
   from the sandbox where these same constraints were already enforced.

2. **Compute FK-safe order from the live sandbox at generation time** (new
   `computeCreateOrder()`), instead of trusting the stale `_fk-order.json`.
   Self-referencing FKs are skipped so Kahn's algorithm can emit every table.

## Files changed
- `server/scripts/generate-full-schema.mjs` — reorder data-before-FK; compute
  create order live; skip self-refs in the topological sort.
- `docs/data/collection-schema.sql` — regenerated (now 42 tables, all INSERTs
  precede all FK constraints).

## Second issue: untrusted FKs / orphan rows (Msg 547 on ALTER)
After the ordering fix, the script progressed but then failed on the FK
*constraint* step:

```
Msg 547 ... The ALTER TABLE statement conflicted with the FOREIGN KEY
constraint "FK_ticket_response_values_ticket_field_id". The conflict occurred
in database "wcpss-data-collection", table "dbo.ticket_fields", column 'id'.
```

### Root cause
The sandbox has **8 orphan rows** in `ticket_response_values` whose
`ticket_field_id` (2-6) no longer exist in `ticket_fields` (which now starts at
ID 19). In SQL Server this is only possible because the FK was created with
`WITH NOCHECK` (it was never validated). In fact, **all 77 FKs in the sandbox
are untrusted** (`is_not_trusted = true`).

The generator was hard-coding `WITH CHECK`, so when it re-validated the
constraint against the freshly-loaded (orphan-containing) data, it failed.

### Fix
`buildFkAlters` now reads `fk.is_not_trusted` from the sandbox and faithfully
mirrors it: untrusted → `WITH NOCHECK`, trusted → `WITH CHECK`. The script now
reproduces the exact FK state of the sandbox rather than assuming the data is
fully validated. Result: all 77 FKs emit `WITH NOCHECK`.

### Note for the user
These 8 orphans are real data in the sandbox (pre-existing, not introduced by
the generator). The script preserves them as-is so the recreated DB matches the
sandbox. If you want the target DB to be FK-clean, you can delete or repair
those 8 rows after the script runs, then re-trust the FKs
(`ALTER TABLE ... WITH CHECK CHECK CONSTRAINT ALL;`).

## Verification
- `node server/scripts/_verify-schema-data.mjs` → `Checked 42 tables. Mismatches: 0`
- All INSERTs precede the first FK constraint in the file.
- `WITH NOCHECK` = 77, `WITH CHECK` = 0 — mirrors sandbox trust state.
- `ADD CONSTRAINT` = 77, `INSERT` = 36.
