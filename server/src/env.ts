import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

const rootEnvPath = path.resolve(__dirname, '../.env')
const envName = process.env.NODE_ENV === 'production' ? 'production' : 'development'
const scopedEnvPath = path.resolve(__dirname, `../.env.${envName}`)

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath })
}

if (fs.existsSync(scopedEnvPath)) {
  dotenv.config({ path: scopedEnvPath, override: true })
}

/**
 * Reads a feature flag that is OFF unless explicitly switched on.
 *
 * This is deliberately the opposite default to `APPROVAL_WORKFLOW_ENABLED !== 'false'`
 * elsewhere: those flags guard features that are expected to be present, whereas these
 * guard scheduled work that has been retired. An unset, empty or misspelled value must
 * leave the check off — reading it as "on" would silently re-arm something the
 * deployment asked to stop, and nothing would appear to have changed.
 */
function isOptInFlag(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === 'true'
}

/**
 * The due-soon / overdue notification sweep.
 *
 * `collections.date_due` is presented for information only; no part of the app should
 * act on that date on a schedule. Off by default.
 */
export function dueDateNotificationsEnabled(): boolean {
  return isOptInFlag('DUE_DATE_NOTIFICATIONS_ENABLED')
}

/**
 * Approval-workflow stage reminders and time-based escalations.
 *
 * Both are driven by elapsed wall-clock time against a stage's `due_at`, so they are
 * retired alongside the due-date checks. Off by default.
 */
export function workflowTimedChecksEnabled(): boolean {
  return isOptInFlag('WORKFLOW_TIMED_CHECKS_ENABLED')
}