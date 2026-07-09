import { getDbAsync } from '../database/db'
import type { DbAdapter } from '../database/types'
import { createNotificationEventWithDeliveries } from './notifications'

export type ApprovalAssignmentType = 'user' | 'role'
export type ApprovalConditionOperator = 'equals' | 'not_equals' | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal' | 'contains' | 'not_empty' | 'is_empty'
export type ApprovalWorkflowStatus = 'not_started' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'escalated'
export type ApprovalStageStatus = 'pending' | 'approved' | 'rejected' | 'skipped' | 'escalated'

export interface ApprovalCondition {
  fieldKey: string
  operator: ApprovalConditionOperator
  value?: string | number | boolean | null
}

export interface ApprovalConditionGroup {
  match: 'all' | 'any'
  conditions: ApprovalCondition[]
}

export interface ApprovalAssigneeDefinition {
  type: ApprovalAssignmentType
  value: string
}

export interface ApprovalStageDefinition {
  id: string
  name: string
  approvalMode: 'all' | 'any'
  assignees: ApprovalAssigneeDefinition[]
  conditions?: ApprovalConditionGroup | null
  reminderAfterHours?: number | null
  escalationAfterHours?: number | null
  escalationAssignees?: ApprovalAssigneeDefinition[] | null
}

export interface ApprovalWorkflowDefinition {
  enabled: boolean
  stages: ApprovalStageDefinition[]
}

export interface ApprovalWorkflowSummary {
  id: number
  status: ApprovalWorkflowStatus
  activeStageOrder: number | null
  activeStageName: string | null
  startedAt: string | null
  completedAt: string | null
  stages: ApprovalWorkflowStageSummary[]
}

export interface ApprovalWorkflowStageSummary {
  id: number
  stageId: string
  stageName: string
  stageOrder: number
  approvalMode: 'all' | 'any'
  status: ApprovalStageStatus
  startedAt: string | null
  dueAt: string | null
  remindedAt: string | null
  escalatedAt: string | null
  actedAt: string | null
  actedBy: number | null
  actionComment: string | null
  approvers: ApprovalWorkflowApproverSummary[]
}

export interface ApprovalWorkflowApproverSummary {
  id: number
  assignmentType: ApprovalAssignmentType
  assignmentValue: string
  userId: number | null
  userName: string | null
  userEmail: string | null
  status: ApprovalStageStatus
  notifiedAt: string | null
  actedAt: string | null
  actedBy: number | null
  actionComment: string | null
}

interface DbWorkflowInstance {
  id: number
  collection_id: number
  response_id: number
  status: ApprovalWorkflowStatus
  active_stage_order: number | null
  active_stage_name: string | null
  started_at: string | null
  completed_at: string | null
}

interface DbStageInstance {
  id: number
  workflow_instance_id: number
  stage_id: string
  stage_name: string
  stage_order: number
  approval_mode: 'all' | 'any'
  status: ApprovalStageStatus
  started_at: string | null
  due_at: string | null
  reminded_at: string | null
  escalated_at: string | null
  acted_at: string | null
  acted_by: number | null
  action_comment: string | null
}

interface DbApproverInstance {
  id: number
  stage_instance_id: number
  assignment_type: ApprovalAssignmentType
  assignment_value: string
  user_id: number | null
  status: ApprovalStageStatus
  notified_at: string | null
  acted_at: string | null
  acted_by: number | null
  action_comment: string | null
  user_name: string | null
  user_email: string | null
}

interface WorkflowFieldValue {
  fieldKey: string
  value: string | null
}

function normalizePositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return Math.floor(parsed)
}

function normalizeAssignee(input: unknown): ApprovalAssigneeDefinition | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const type = record.type === 'role' ? 'role' : record.type === 'user' ? 'user' : null
  const value = String(record.value ?? '').trim()
  if (!type || !value) return null
  return { type, value }
}

function normalizeCondition(input: unknown): ApprovalCondition | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const fieldKey = String(record.fieldKey ?? '').trim()
  const operator = String(record.operator ?? '').trim() as ApprovalConditionOperator
  if (!fieldKey) return null
  if (!['equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal', 'contains', 'not_empty', 'is_empty'].includes(operator)) {
    return null
  }
  return {
    fieldKey,
    operator,
    value: record.value as string | number | boolean | null | undefined,
  }
}

function normalizeConditionGroup(input: unknown): ApprovalConditionGroup | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const match = record.match === 'any' ? 'any' : 'all'
  const conditions = Array.isArray(record.conditions)
    ? record.conditions.map(normalizeCondition).filter((item): item is ApprovalCondition => item !== null)
    : []
  return conditions.length > 0 ? { match, conditions } : null
}

function normalizeStage(input: unknown, index: number): ApprovalStageDefinition | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const name = String(record.name ?? '').trim()
  const assignees = Array.isArray(record.assignees)
    ? record.assignees.map(normalizeAssignee).filter((item): item is ApprovalAssigneeDefinition => item !== null)
    : []
  if (!name || assignees.length === 0) return null
  const escalationAssignees = Array.isArray(record.escalationAssignees)
    ? record.escalationAssignees.map(normalizeAssignee).filter((item): item is ApprovalAssigneeDefinition => item !== null)
    : []
  return {
    id: String(record.id ?? `stage-${index + 1}`).trim() || `stage-${index + 1}`,
    name,
    approvalMode: record.approvalMode === 'any' ? 'any' : 'all',
    assignees,
    conditions: normalizeConditionGroup(record.conditions),
    reminderAfterHours: normalizePositiveInteger(record.reminderAfterHours),
    escalationAfterHours: normalizePositiveInteger(record.escalationAfterHours),
    escalationAssignees: escalationAssignees.length > 0 ? escalationAssignees : null,
  }
}

export function normalizeWorkflowDefinition(input: unknown): ApprovalWorkflowDefinition | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const enabled = record.enabled === true
  const stages = Array.isArray(record.stages)
    ? record.stages.map(normalizeStage).filter((item): item is ApprovalStageDefinition => item !== null)
    : []
  if (!enabled || stages.length === 0) {
    return enabled ? { enabled: false, stages: [] } : null
  }
  return { enabled: true, stages }
}

export function parseWorkflowDefinition(raw: string | null): ApprovalWorkflowDefinition | null {
  if (!raw) return null
  try {
    return normalizeWorkflowDefinition(JSON.parse(raw))
  } catch {
    return null
  }
}

export function serializeWorkflowDefinition(definition?: ApprovalWorkflowDefinition | null): string | null {
  const normalized = normalizeWorkflowDefinition(definition ?? null)
  return normalized ? JSON.stringify(normalized) : null
}

function parseStoredValue(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item ?? '').trim()).filter(Boolean)
    }
  } catch {
    // ignore
  }
  const value = String(raw).trim()
  return value ? [value] : []
}

function compareCondition(actualValues: string[], condition: ApprovalCondition): boolean {
  if (condition.operator === 'is_empty') return actualValues.length === 0
  if (condition.operator === 'not_empty') return actualValues.length > 0

  const expectedText = condition.value === null || condition.value === undefined ? '' : String(condition.value)
  const actualText = actualValues[0] ?? ''
  const actualNumber = Number(actualText)
  const expectedNumber = Number(condition.value)

  switch (condition.operator) {
    case 'equals':
      return actualValues.some((value) => value === expectedText)
    case 'not_equals':
      return actualValues.length === 0 || actualValues.every((value) => value !== expectedText)
    case 'contains':
      return actualValues.some((value) => value.toLowerCase().includes(expectedText.toLowerCase()))
    case 'greater_than':
      return Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && actualNumber > expectedNumber
    case 'greater_or_equal':
      return Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && actualNumber >= expectedNumber
    case 'less_than':
      return Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && actualNumber < expectedNumber
    case 'less_or_equal':
      return Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && actualNumber <= expectedNumber
    default:
      return false
  }
}

function stageConditionsMatch(stage: ApprovalStageDefinition, valueMap: Map<string, string[]>): boolean {
  if (!stage.conditions || stage.conditions.conditions.length === 0) return true
  const results = stage.conditions.conditions.map((condition) => compareCondition(valueMap.get(condition.fieldKey) ?? [], condition))
  return stage.conditions.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

function resolveUserIdsForAssignee(db: DbAdapter, organizationId: number | null, assignee: ApprovalAssigneeDefinition): Promise<number[]> {
  if (assignee.type === 'user') {
    const userId = Number(assignee.value)
    return Promise.resolve(Number.isInteger(userId) && userId > 0 ? [userId] : [])
  }

  const role = assignee.value.trim()
  if (!role) return Promise.resolve([])

  return (async () => {
    const direct = await db.queryAll<{ id: number }>(
        `SELECT DISTINCT id
       FROM users
       WHERE role = ?
         AND (? IS NULL OR organization_id = ?)`,
        [role, organizationId, organizationId]
      )

    const membership = await db.queryAll<{ id: number }>(
        `SELECT DISTINCT u.id
       FROM users u
       JOIN user_organizations uo ON uo.user_id = u.id
       WHERE uo.role = ?
         AND (? IS NULL OR uo.organization_id = ?)`,
        [role, organizationId, organizationId]
      )

    return Array.from(new Set([...direct, ...membership].map((row) => row.id).filter((id) => Number.isInteger(id))))
  })()
}

function addHoursIso(date: Date, hours: number | null | undefined): string | null {
  if (!hours || hours < 1) return null
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString()
}

async function insertHistory(
  db: DbAdapter,
  workflowInstanceId: number,
  eventType: 'workflow_started' | 'stage_started' | 'approved' | 'rejected' | 'reminder_sent' | 'escalated' | 'workflow_completed' | 'workflow_cancelled',
  options?: {
    stageInstanceId?: number | null
    approverInstanceId?: number | null
    actorUserId?: number | null
    actorName?: string | null
    message?: string | null
    metadata?: Record<string, unknown> | null
  },
): Promise<void> {
  await db.execute(
    `INSERT INTO approval_workflow_history (
       workflow_instance_id, stage_instance_id, approver_instance_id, event_type,
       actor_user_id, actor_name, message, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      workflowInstanceId,
      options?.stageInstanceId ?? null,
      options?.approverInstanceId ?? null,
      eventType,
      options?.actorUserId ?? null,
      options?.actorName ?? null,
      options?.message ?? null,
      options?.metadata ? JSON.stringify(options.metadata) : null,
    ]
  )
}

function notifyApprovers(
  db: DbAdapter,
  workflowInstanceId: number,
  stage: DbStageInstance,
  collectionId: number,
  responseId: number,
  organizationId: number | null,
  collectionTitle: string,
  approverRows: DbApproverInstance[],
  kind: 'assigned' | 'reminder' | 'escalation',
): void {
  const submissionLabel = `Submission #${responseId}`
  const title = kind === 'reminder'
    ? `Approval reminder: ${stage.stage_name} (${submissionLabel})`
    : kind === 'escalation'
      ? `Approval escalated: ${stage.stage_name} (${submissionLabel})`
      : `Approval needed: ${stage.stage_name} (${submissionLabel})`
  const message = kind === 'reminder'
    ? `The approval stage "${stage.stage_name}" is still pending for "${collectionTitle}", ${submissionLabel}.`
    : kind === 'escalation'
      ? `The approval stage "${stage.stage_name}" for "${collectionTitle}", ${submissionLabel}, has been escalated.`
      : `Your approval is requested for "${collectionTitle}", ${submissionLabel}, at stage "${stage.stage_name}".`

  const recipients = approverRows.flatMap((approver) => {
    const items: Array<{ userId?: number | null; email?: string | null; channel: 'in_app' | 'email'; role?: 'primary' | 'cc' }> = []
    if (approver.user_id) {
      items.push({ userId: approver.user_id, channel: 'in_app', role: 'primary' })
      if (approver.user_email) {
        items.push({ email: approver.user_email, channel: 'email', role: 'primary' })
      }
    }
    return items
  })

  if (recipients.length === 0) return

  void createNotificationEventWithDeliveries({
    organizationId,
    type: 'system',
    title,
    message,
    collectionId,
    targetType: 'submission',
    targetId: responseId,
    actionUrl: `/records?collectionId=${collectionId}&responseId=${responseId}`,
    priority: kind === 'escalation' ? 'high' : 'normal',
    dedupeKey: `${kind}:${workflowInstanceId}:${stage.id}`,
    metadata: { workflowInstanceId, stageInstanceId: stage.id, responseId },
  }, recipients, db)
}

async function reconcilePendingStageApprovers(
  db: DbAdapter,
  workflow: DbWorkflowInstance,
  stage: DbStageInstance,
): Promise<void> {
  if (stage.status !== 'pending') {
    return
  }

  const approvers = await db.queryAll<DbApproverInstance>(
    `SELECT ai.*, u.name AS user_name, u.email AS user_email
     FROM approval_workflow_approver_instances ai
     LEFT JOIN users u ON u.id = ai.user_id
     WHERE ai.stage_instance_id = ?
     ORDER BY ai.id ASC`,
    [stage.id]
  )

  const collection = await db.queryOne<{ organization_id: number | null }>('SELECT organization_id FROM collections WHERE id = ?', [workflow.collection_id])
  const organizationId = collection?.organization_id ?? null

  for (const approver of approvers) {
    if (approver.assignment_type !== 'role' || approver.user_id !== null || approver.status !== 'skipped') {
      continue
    }

    const userIds = await resolveUserIdsForAssignee(db, organizationId, {
      type: approver.assignment_type,
      value: approver.assignment_value,
    })

    if (userIds.length === 0) {
      continue
    }

    const existingRows = await db.queryAll<{ user_id: number | null }>(
      `SELECT user_id
       FROM approval_workflow_approver_instances
       WHERE stage_instance_id = ?
         AND assignment_type = ?
         AND assignment_value = ?
         AND user_id IS NOT NULL`,
      [stage.id, approver.assignment_type, approver.assignment_value]
    )
    const existingUserIds = new Set(existingRows.map((row) => row.user_id).filter((userId): userId is number => Number.isInteger(userId)))

    for (const userId of userIds.filter((id) => !existingUserIds.has(id))) {
      await db.execute(
        `INSERT INTO approval_workflow_approver_instances (
             stage_instance_id, assignment_type, assignment_value, user_id, status, notified_at, updated_at
           ) VALUES (?, ?, ?, ?, 'pending', ?, datetime('now'))`,
        [stage.id, approver.assignment_type, approver.assignment_value, userId, stage.started_at]
      )
    }

    await db.execute('DELETE FROM approval_workflow_approver_instances WHERE id = ?', [approver.id])
  }
}

async function reconcileWorkflowApprovers(db: DbAdapter, workflow: DbWorkflowInstance): Promise<void> {
  if (workflow.status !== 'pending') {
    return
  }

  const stages = await db.queryAll<DbStageInstance>(
    `SELECT *
     FROM approval_workflow_stage_instances
     WHERE workflow_instance_id = ?
       AND status = 'pending'`,
    [workflow.id]
  )

  for (const stage of stages) {
    await reconcilePendingStageApprovers(db, workflow, stage)
  }
}

async function loadStageSummaries(db: DbAdapter, workflowInstanceId: number): Promise<ApprovalWorkflowStageSummary[]> {
  const stages = await db.queryAll<DbStageInstance>(
    `SELECT *
     FROM approval_workflow_stage_instances
     WHERE workflow_instance_id = ?
     ORDER BY stage_order ASC, id ASC`,
    [workflowInstanceId]
  )

  const approvers = await db.queryAll<DbApproverInstance>(
    `SELECT ai.*, u.name AS user_name, u.email AS user_email
     FROM approval_workflow_approver_instances ai
     LEFT JOIN users u ON u.id = ai.user_id
     WHERE ai.stage_instance_id IN (
       SELECT id FROM approval_workflow_stage_instances WHERE workflow_instance_id = ?
     )
     ORDER BY ai.id ASC`,
    [workflowInstanceId]
  )

  const approversByStage = new Map<number, ApprovalWorkflowApproverSummary[]>()
  for (const approver of approvers) {
    const items = approversByStage.get(approver.stage_instance_id) ?? []
    items.push({
      id: approver.id,
      assignmentType: approver.assignment_type,
      assignmentValue: approver.assignment_value,
      userId: approver.user_id,
      userName: approver.user_name,
      userEmail: approver.user_email,
      status: approver.status,
      notifiedAt: approver.notified_at,
      actedAt: approver.acted_at,
      actedBy: approver.acted_by,
      actionComment: approver.action_comment,
    })
    approversByStage.set(approver.stage_instance_id, items)
  }

  return stages.map((stage) => ({
    id: stage.id,
    stageId: stage.stage_id,
    stageName: stage.stage_name,
    stageOrder: stage.stage_order,
    approvalMode: stage.approval_mode,
    status: stage.status,
    startedAt: stage.started_at,
    dueAt: stage.due_at,
    remindedAt: stage.reminded_at,
    escalatedAt: stage.escalated_at,
    actedAt: stage.acted_at,
    actedBy: stage.acted_by,
    actionComment: stage.action_comment,
    approvers: approversByStage.get(stage.id) ?? [],
  }))
}

export async function getWorkflowSummaryForResponse(responseId: number, dbArg?: DbAdapter): Promise<ApprovalWorkflowSummary | null> {
  const db = dbArg ?? await getDbAsync()
  const workflow = await db.queryOne<DbWorkflowInstance>(
    `SELECT id, collection_id, response_id, status, active_stage_order, active_stage_name, started_at, completed_at
     FROM approval_workflow_instances
     WHERE response_id = ?`,
    [responseId]
  )

  if (!workflow) return null
  await reconcileWorkflowApprovers(db, workflow)
  return {
    id: workflow.id,
    status: workflow.status,
    activeStageOrder: workflow.active_stage_order,
    activeStageName: workflow.active_stage_name,
    startedAt: workflow.started_at,
    completedAt: workflow.completed_at,
    stages: await loadStageSummaries(db, workflow.id),
  }
}

export async function initializeWorkflowForResponse(input: {
  collectionId: number
  responseId: number
  organizationId: number | null
  collectionTitle: string
  workflowDefinition: ApprovalWorkflowDefinition | null
  fieldValues: WorkflowFieldValue[]
  db?: DbAdapter
}): Promise<void> {
  const db = input.db ?? await getDbAsync()
  const definition = normalizeWorkflowDefinition(input.workflowDefinition)
  if (!definition || !definition.enabled || definition.stages.length === 0) {
    return
  }

  const existing = await db.queryOne<{ id: number }>('SELECT id FROM approval_workflow_instances WHERE response_id = ?', [input.responseId])
  if (existing) return

  const valueMap = new Map<string, string[]>()
  input.fieldValues.forEach((item) => valueMap.set(item.fieldKey, parseStoredValue(item.value)))

  const now = new Date()
  const inserted = await db.execute(
    `INSERT INTO approval_workflow_instances (
       collection_id, response_id, status, active_stage_order, active_stage_name, started_at, updated_at
     ) VALUES (?, ?, 'pending', NULL, NULL, ?, datetime('now'))`,
    [input.collectionId, input.responseId, now.toISOString()]
  )
  const workflowInstanceId = Number(inserted.lastInsertRowid)
  await insertHistory(db, workflowInstanceId, 'workflow_started', { message: 'Approval workflow started' })

  let firstActiveStageRow: DbStageInstance | null = null
  let firstActiveStageApprovers: DbApproverInstance[] = []

  for (const [index, stage] of definition.stages.entries()) {
    const matches = stageConditionsMatch(stage, valueMap)
    const startedAt = matches && firstActiveStageRow === null ? now.toISOString() : null
    const dueAt = matches && firstActiveStageRow === null
      ? addHoursIso(now, stage.escalationAfterHours ?? stage.reminderAfterHours ?? null)
      : null
    const status: ApprovalStageStatus = matches ? 'pending' : 'skipped'
    const stageInsert = await db.execute(
      `INSERT INTO approval_workflow_stage_instances (
         workflow_instance_id, stage_id, stage_name, stage_order, approval_mode, status,
         conditions_json, reminder_after_hours, escalation_after_hours, started_at, due_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        workflowInstanceId,
        stage.id,
        stage.name,
        index + 1,
        stage.approvalMode,
        status,
        stage.conditions ? JSON.stringify(stage.conditions) : null,
        stage.reminderAfterHours ?? null,
        stage.escalationAfterHours ?? null,
        startedAt,
        dueAt,
      ]
    )
    const stageInstanceId = Number(stageInsert.lastInsertRowid)

    const assigneeSource = status === 'pending' ? stage.assignees : []
    const approverRows: DbApproverInstance[] = []
    for (const assignee of assigneeSource) {
      const userIds = await resolveUserIdsForAssignee(db, input.organizationId, assignee)
      if (userIds.length === 0) {
        await db.execute(
          `INSERT INTO approval_workflow_approver_instances (
             stage_instance_id, assignment_type, assignment_value, user_id, status, updated_at
           ) VALUES (?, ?, ?, NULL, 'skipped', datetime('now'))`,
          [stageInstanceId, assignee.type, assignee.value]
        )
        continue
      }

      for (const userId of userIds) {
        const insertedApprover = await db.execute(
          `INSERT INTO approval_workflow_approver_instances (
             stage_instance_id, assignment_type, assignment_value, user_id, status, notified_at, updated_at
           ) VALUES (?, ?, ?, ?, 'pending', ?, datetime('now'))`,
          [stageInstanceId, assignee.type, assignee.value, userId, startedAt]
        )
        const approverId = Number(insertedApprover.lastInsertRowid)
        const user = await db.queryOne<{ user_name: string | null; user_email: string | null }>('SELECT name AS user_name, email AS user_email FROM users WHERE id = ?', [userId])
        approverRows.push({
          id: approverId,
          stage_instance_id: stageInstanceId,
          assignment_type: assignee.type,
          assignment_value: assignee.value,
          user_id: userId,
          status: 'pending',
          notified_at: startedAt,
          acted_at: null,
          acted_by: null,
          action_comment: null,
          user_name: user?.user_name ?? null,
          user_email: user?.user_email ?? null,
        })
      }
    }

    if (status === 'pending' && firstActiveStageRow === null) {
      const row: DbStageInstance = {
        id: stageInstanceId,
        workflow_instance_id: workflowInstanceId,
        stage_id: stage.id,
        stage_name: stage.name,
        stage_order: index + 1,
        approval_mode: stage.approvalMode,
        status,
        started_at: startedAt,
        due_at: dueAt,
        reminded_at: null,
        escalated_at: null,
        acted_at: null,
        acted_by: null,
        action_comment: null,
      }
      firstActiveStageRow = row
      firstActiveStageApprovers = approverRows
      await insertHistory(db, workflowInstanceId, 'stage_started', { stageInstanceId, message: `Stage started: ${stage.name}` })
    }
  }

  if (!firstActiveStageRow) {
    await db.execute(
      `UPDATE approval_workflow_instances
       SET status = 'approved', completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
      [workflowInstanceId]
    )
    await insertHistory(db, workflowInstanceId, 'workflow_completed', { message: 'Workflow auto-completed with no applicable stages' })
    return
  }

  await db.execute(
    `UPDATE approval_workflow_instances
     SET active_stage_order = ?, active_stage_name = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [firstActiveStageRow.stage_order, firstActiveStageRow.stage_name, workflowInstanceId]
  )

  notifyApprovers(
    db,
    workflowInstanceId,
    firstActiveStageRow,
    input.collectionId,
    input.responseId,
    input.organizationId,
    input.collectionTitle,
    firstActiveStageApprovers,
    'assigned',
  )
}

async function activateNextPendingStage(db: DbAdapter, workflow: DbWorkflowInstance, collectionTitle: string, organizationId: number | null): Promise<void> {
  const nextStage = await db.queryOne<DbStageInstance>(
    `SELECT *
     FROM approval_workflow_stage_instances
     WHERE workflow_instance_id = ?
       AND status = 'pending'
       AND started_at IS NULL
     ORDER BY stage_order ASC
     LIMIT 1`,
    [workflow.id]
  )

  if (!nextStage) {
    await db.execute(
      `UPDATE approval_workflow_instances
       SET status = 'approved', active_stage_order = NULL, active_stage_name = NULL,
           completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
      [workflow.id]
    )
    await insertHistory(db, workflow.id, 'workflow_completed', { message: 'Workflow approved' })
    return
  }

  const now = new Date()
  const stageInfo = await db.queryOne<{ escalation_after_hours: number | null; reminder_after_hours: number | null }>('SELECT escalation_after_hours, reminder_after_hours FROM approval_workflow_stage_instances WHERE id = ?', [nextStage.id])
  const dueAt = addHoursIso(now, stageInfo?.escalation_after_hours ?? null)
    ?? addHoursIso(now, stageInfo?.reminder_after_hours ?? null)

  await db.execute(
    `UPDATE approval_workflow_stage_instances
     SET started_at = ?, due_at = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [now.toISOString(), dueAt, nextStage.id]
  )

  await db.execute(
    `UPDATE approval_workflow_approver_instances
     SET notified_at = COALESCE(notified_at, ?), updated_at = datetime('now')
     WHERE stage_instance_id = ? AND status = 'pending'`,
    [now.toISOString(), nextStage.id]
  )

  await db.execute(
    `UPDATE approval_workflow_instances
     SET active_stage_order = ?, active_stage_name = ?, status = 'pending', updated_at = datetime('now')
     WHERE id = ?`,
    [nextStage.stage_order, nextStage.stage_name, workflow.id]
  )

  await insertHistory(db, workflow.id, 'stage_started', { stageInstanceId: nextStage.id, message: `Stage started: ${nextStage.stage_name}` })

  const approvers = await db.queryAll<DbApproverInstance>(
    `SELECT ai.*, u.name AS user_name, u.email AS user_email
     FROM approval_workflow_approver_instances ai
     LEFT JOIN users u ON u.id = ai.user_id
     WHERE ai.stage_instance_id = ?`,
    [nextStage.id]
  )

  notifyApprovers(db, workflow.id, { ...nextStage, started_at: now.toISOString(), due_at: dueAt }, workflow.collection_id, workflow.response_id, organizationId, collectionTitle, approvers, 'assigned')
}

export async function actOnWorkflowStage(input: {
  responseId: number
  userId: number
  actorName: string | null
  decision: 'approved' | 'rejected'
  comment?: string | null
  db?: DbAdapter
}): Promise<ApprovalWorkflowSummary | null> {
  const db = input.db ?? await getDbAsync()
  const workflow = await db.queryOne<DbWorkflowInstance>(
    `SELECT id, collection_id, response_id, status, active_stage_order, active_stage_name, started_at, completed_at
     FROM approval_workflow_instances
     WHERE response_id = ?`,
    [input.responseId]
  )
  if (!workflow || workflow.status !== 'pending') return workflow ? getWorkflowSummaryForResponse(input.responseId, db) : null
  await reconcileWorkflowApprovers(db, workflow)

  const stage = await db.queryOne<DbStageInstance>(
    `SELECT *
     FROM approval_workflow_stage_instances
     WHERE workflow_instance_id = ?
       AND stage_order = ?
     LIMIT 1`,
    [workflow.id, workflow.active_stage_order]
  )
  if (!stage || stage.status !== 'pending' || !stage.started_at) return getWorkflowSummaryForResponse(input.responseId, db)

  const approver = await db.queryOne<DbApproverInstance>(
    `SELECT ai.*, u.name AS user_name, u.email AS user_email
     FROM approval_workflow_approver_instances ai
     LEFT JOIN users u ON u.id = ai.user_id
     WHERE ai.stage_instance_id = ? AND ai.user_id = ? AND ai.status = 'pending'
     LIMIT 1`,
    [stage.id, input.userId]
  )
  if (!approver) return getWorkflowSummaryForResponse(input.responseId, db)

  const actedAt = new Date().toISOString()
  await db.execute(
    `UPDATE approval_workflow_approver_instances
     SET status = ?, acted_at = ?, acted_by = ?, action_comment = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [input.decision, actedAt, input.userId, input.comment?.trim() ?? null, approver.id]
  )

  await insertHistory(db, workflow.id, input.decision, {
    stageInstanceId: stage.id,
    approverInstanceId: approver.id,
    actorUserId: input.userId,
    actorName: input.actorName,
    message: input.comment?.trim() || `${input.decision} by ${input.actorName ?? 'approver'}`,
  })

  const pendingCountRow = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM approval_workflow_approver_instances
     WHERE stage_instance_id = ? AND status = 'pending'`,
    [stage.id]
  )
  const approvedCountRow = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM approval_workflow_approver_instances
     WHERE stage_instance_id = ? AND status = 'approved'`,
    [stage.id]
  )
  const rejectedCountRow = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM approval_workflow_approver_instances
     WHERE stage_instance_id = ? AND status = 'rejected'`,
    [stage.id]
  )

  let stageStatus: ApprovalStageStatus = 'pending'
  if (input.decision === 'rejected') {
    stageStatus = 'rejected'
  } else if (stage.approval_mode === 'any' && (approvedCountRow?.count ?? 0) > 0) {
    stageStatus = 'approved'
  } else if (stage.approval_mode === 'all' && (pendingCountRow?.count ?? 0) === 0 && (rejectedCountRow?.count ?? 0) === 0) {
    stageStatus = 'approved'
  }

  if (stageStatus !== 'pending') {
    await db.execute(
      `UPDATE approval_workflow_stage_instances
       SET status = ?, acted_at = ?, acted_by = ?, action_comment = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [stageStatus, actedAt, input.userId, input.comment?.trim() ?? null, stage.id]
    )

    const collection = await db.queryOne<{ title: string; organization_id: number | null }>('SELECT title, organization_id FROM collections WHERE id = ?', [workflow.collection_id])

    if (stageStatus === 'rejected') {
      await db.execute(
        `UPDATE approval_workflow_instances
         SET status = 'rejected', active_stage_order = NULL, active_stage_name = NULL,
             completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
        [workflow.id]
      )
    } else {
      await activateNextPendingStage(db, workflow, collection?.title ?? 'Request', collection?.organization_id ?? null)
    }
  }

  return getWorkflowSummaryForResponse(input.responseId, db)
}

export async function processWorkflowEscalations(dbArg?: DbAdapter): Promise<void> {
  const db = dbArg ?? await getDbAsync()
  const nowIso = new Date().toISOString()
  const activeStages = await db.queryAll<DbStageInstance & { collection_id: number; response_id: number; collection_title: string; organization_id: number | null }>(
    `SELECT s.*, w.collection_id, w.response_id, c.title AS collection_title, c.organization_id
     FROM approval_workflow_stage_instances s
     JOIN approval_workflow_instances w ON w.id = s.workflow_instance_id
     JOIN collections c ON c.id = w.collection_id
     WHERE w.status = 'pending'
       AND s.status = 'pending'
       AND s.started_at IS NOT NULL`
  )

  for (const stage of activeStages) {
    const reminderAfterHours = await db.queryOne<{ reminder_after_hours: number | null; escalation_after_hours: number | null }>('SELECT reminder_after_hours, escalation_after_hours FROM approval_workflow_stage_instances WHERE id = ?', [stage.id])
    const startedAt = stage.started_at ? new Date(stage.started_at) : null
    if (!startedAt) continue
    const elapsedMs = Date.now() - startedAt.getTime()

    const approvers = await db.queryAll<DbApproverInstance>(
      `SELECT ai.*, u.name AS user_name, u.email AS user_email
       FROM approval_workflow_approver_instances ai
       LEFT JOIN users u ON u.id = ai.user_id
       WHERE ai.stage_instance_id = ? AND ai.status = 'pending'`,
      [stage.id]
    )
    if (approvers.length === 0) continue

    if (reminderAfterHours?.reminder_after_hours && !stage.reminded_at && elapsedMs >= reminderAfterHours.reminder_after_hours * 60 * 60 * 1000) {
      notifyApprovers(db, stage.workflow_instance_id, stage, stage.collection_id, stage.response_id, stage.organization_id, stage.collection_title, approvers, 'reminder')
      await db.execute(
        `UPDATE approval_workflow_stage_instances
         SET reminded_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [nowIso, stage.id]
      )
      await insertHistory(db, stage.workflow_instance_id, 'reminder_sent', { stageInstanceId: stage.id, message: `Reminder sent for ${stage.stage_name}` })
    }

    if (reminderAfterHours?.escalation_after_hours && !stage.escalated_at && elapsedMs >= reminderAfterHours.escalation_after_hours * 60 * 60 * 1000) {
      notifyApprovers(db, stage.workflow_instance_id, stage, stage.collection_id, stage.response_id, stage.organization_id, stage.collection_title, approvers, 'escalation')
      await db.execute(
        `UPDATE approval_workflow_stage_instances
         SET status = 'escalated', escalated_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [nowIso, stage.id]
      )
      await db.execute(
        `UPDATE approval_workflow_instances
         SET status = 'escalated', last_escalated_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [nowIso, stage.workflow_instance_id]
      )
      await insertHistory(db, stage.workflow_instance_id, 'escalated', { stageInstanceId: stage.id, message: `Stage escalated: ${stage.stage_name}` })
    }
  }
}