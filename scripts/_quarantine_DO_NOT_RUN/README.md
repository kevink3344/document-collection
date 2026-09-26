# ⛔ QUARANTINED SCRIPTS — DO NOT RUN

These files were moved here on **2026-09-25** because they contain
**destructive `DROP TABLE` / `DROP DATABASE` logic** that can wipe a live
database. They are renamed with a `.quarantined` extension so they cannot be
executed by Node/SQL clients by accident.

## Why these are dangerous

The production database `wcpss-data-collection`
(`wcpsssqlelasticpool.database.windows.net`) was found with only **9 of 42
tables** and its responses missing. The most likely cause was a **partial or
interrupted run of a generated full-schema script** that begins by dropping
every foreign key and then every table.

## What was quarantined

| File | Danger |
|------|--------|
| `collection-schema.sql.quarantined` | **42 × `DROP TABLE`.** Generated full-recreation script. Starts with a FK-drop cursor, then drops all 42 tables, then recreates + seeds from the SANDBOX. Running this against production destroys all data. |
| `generate-full-schema.mjs.quarantined` | **Generator** for the file above. Reads the sandbox and writes a script containing `IF OBJECT_ID(...) IS NOT NULL DROP TABLE ...` for every table. |
| `migrate-turso-to-sqlserver.mjs.quarantined` | Drops each target table (`IF OBJECT_ID(...) IS NOT NULL DROP TABLE ...`) before recreating during migration. |
| `migrate-to-turso.mjs.quarantined` | `DROP TABLE IF EXISTS <table>` while migrating to Turso. |
| `add-super-admin.mjs.quarantined` | Contains `DROP TABLE users_new` and `DROP TABLE users`. |

## Recovery reference

A complete backup exists: **`wcpss-data-collection-restored`** on
`wcpsssqlelasticpool.database.windows.net` (42 tables, 194 responses,
2,709 response values, 37 users). Prefer restoring from / repointing to that
database over running anything here.

## If you ever need to regenerate a schema script

Do **NOT** run the quarantined generator against production. Generate against a
**sandbox only**, and always review the output's `USE [<database>]` line before
executing. Better: create missing tables **additively** with
`IF OBJECT_ID(...) IS NULL CREATE TABLE ...` (never `DROP`).

## How to un-quarantine (only if you are certain)

Rename the file back to remove the `.quarantined` suffix, and **run it against a
sandbox / throwaway database first** — never directly against production.
