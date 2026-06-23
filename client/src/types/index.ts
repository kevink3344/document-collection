export type UserRole = 'super_admin' | 'administrator' | 'team_manager' | 'reviewer' | 'user'
export type MembershipRole = Exclude<UserRole, 'super_admin'>

export interface UserOrganizationMembership {
  organizationId: number
  organizationName: string
  organizationSlug: string | null
  organizationDescription?: string | null
  role: MembershipRole
  isDefault: boolean
}

export interface User {
  id: number
  name: string
  email: string
  role: UserRole
  systemRole?: UserRole
  activeOrganizationId: number | null
  activeOrganizationName: string | null
  activeOrganizationSlug: string | null
  activeOrganizationDescription?: string | null
  organizationId: number | null
  organizationName: string | null
  organizationSlug: string | null
  organizationDescription?: string | null
  organization?: string
  createdAt: string
  organizations: UserOrganizationMembership[]
}

export interface Organization {
  id: number
  name: string
  slug: string | null
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  userCount?: number
  collectionCount?: number
}

export interface AuthResponse {
  token: string
  user: User
}

// ── Collections ───────────────────────────────────────────────

export type FieldType =
  | 'short_text'
  | 'date'
  | 'long_text'
  | 'single_choice'
  | 'multiple_choice'
  | 'document'
  | 'attachment'
  | 'signature'
  | 'confirmation'
  | 'custom_table'
  | 'rating'
  | 'comment'
  | 'matrix_likert_scale'
  | 'location'

export type ColType = 'text' | 'number' | 'date' | 'checkbox' | 'list'
export type CollectionType = 'standard' | 'signup_sheet'
export type CollectionStatus = 'draft' | 'published'
export type FieldDisplayStyle = 'radio' | 'dropdown' | 'stars' | 'numbers'
export type ApprovalAssignmentType = 'user' | 'role'
export type ApprovalConditionOperator = 'equals' | 'not_equals' | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal' | 'contains' | 'not_empty' | 'is_empty'
export type ApprovalWorkflowStatus = 'not_started' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'escalated'
export type ApprovalStageStatus = 'pending' | 'approved' | 'rejected' | 'skipped' | 'escalated'

export interface FieldBranchRule {
  value: string
  targetFieldKey: string | null
}

export interface ApprovalWorkflowAssignee {
  type: ApprovalAssignmentType
  value: string
}

export interface ApprovalWorkflowCondition {
  fieldKey: string
  operator: ApprovalConditionOperator
  value?: string | number | boolean | null
}

export interface ApprovalWorkflowConditionGroup {
  match: 'all' | 'any'
  conditions: ApprovalWorkflowCondition[]
}

export interface ApprovalWorkflowStageDefinition {
  id: string
  name: string
  approvalMode: 'all' | 'any'
  assignees: ApprovalWorkflowAssignee[]
  conditions?: ApprovalWorkflowConditionGroup | null
  reminderAfterHours?: number | null
  escalationAfterHours?: number | null
  escalationAssignees?: ApprovalWorkflowAssignee[] | null
}

export interface ApprovalWorkflowDefinition {
  enabled: boolean
  stages: ApprovalWorkflowStageDefinition[]
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

export interface ApprovalWorkflowSummary {
  id: number
  status: ApprovalWorkflowStatus
  activeStageOrder: number | null
  activeStageName: string | null
  startedAt: string | null
  completedAt: string | null
  stages: ApprovalWorkflowStageSummary[]
}

export interface TableColumn {
  id?: number
  name: string
  colType: ColType
  listOptions?: string[] | null
  sortOrder: number
}

export interface CollectionField {
  id?: number
  fieldKey?: string
  type: FieldType
  label: string
  subtitle?: string
  page: number
  required: boolean
  options: string[] | null
  displayStyle?: FieldDisplayStyle
  branchRules?: FieldBranchRule[] | null
  sortOrder: number
  tableColumns: TableColumn[] | null
  staffOnly?: boolean
  locationFilterEnabled?: boolean
}

export interface Collection {
  id: number
  slug: string
  title: string
  status: CollectionStatus
  description: string | null
  category: string | null
  organizationId: number
  organizationName: string | null
  organizationDescription?: string | null
  createdBy: number
  createdByName: string | null
  dateDue: string | null
  coverPhotoUrl: string | null
  coverPhotoAssetId?: number | null
  logoUrl: string | null
  instructions: string | null
  instructionsDocUrl: string | null
  workflowDefinition?: ApprovalWorkflowDefinition | null
  sourceTemplateCollectionId?: number | null
  templateUsageCount?: number
  activeVersionId?: number | null
  currentVersionNumber?: number | null
  currentVersionStatus?: CollectionStatus | null
  anonymous: boolean
  allowSubmissionEdits: boolean
  submissionEditWindowHours: number | null
  collectionType: CollectionType
  createdAt: string
  updatedAt: string
  fields: CollectionField[]
  responseCount?: number
  hasCustomTable?: boolean
}

export interface CollectionVersion {
  id: number
  versionNumber: number
  status: CollectionStatus
  createdBy: number
  createdAt: string
  publishedAt: string | null
  isActive: boolean
}

export interface GalleryAsset {
  id: number
  organizationId: number
  organizationName: string | null
  name: string
  altText: string | null
  tags: string[]
  mimeType: string
  sizeBytes: number
  usageCount: number
  fileUrl: string
  createdByUserId: number | null
  createdAt: string
  updatedAt: string
}

export interface AttachmentReference {
  attachmentId: number
  fileName: string
  mimeType: string
  sizeBytes: number
  downloadUrl: string
  webViewUrl?: string | null
  uploadToken?: string | null
}

export interface CollectionResponse {
  id: number
  respondentName: string | null
  respondentEmail: string | null
  submittedAt: string
  workflow?: ApprovalWorkflowSummary | null
  values: { fieldId: number; value: string | null; fieldLabel?: string | null; staffUpdatedByName?: string | null; staffUpdatedAt?: string | null }[]
}

export interface SubmissionComment {
  id: number
  userId: number
  userName: string
  body: string
  createdAt: string
}

export interface TicketField {
  id?: number
  fieldKey?: string
  type: FieldType
  label: string
  subtitle?: string | null
  page: number
  required: boolean
  options: string[] | null
  displayStyle?: FieldDisplayStyle
  sortOrder: number
  tableColumns: TableColumn[] | null
}

export interface TicketTemplate {
  id: number
  organizationId: number | null
  organizationName: string | null
  title: string
  description: string | null
  createdBy: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  fieldCount: number
  assignmentCount: number
}

export interface CollectionTicketTemplate {
  id: number
  title: string
  description: string | null
  displayOrder: number
  isArchived?: boolean
}

export interface TicketResponse {
  id: number
  collectionResponseId: number
  collectionId: number
  ticketTemplateId: number | null
  filledBy: number | null
  filledAt: string | null
  finalized: boolean
  finalizedAt: string | null
  finalizedByName: string | null
  values: { fieldId: number; value: string | null }[]
}

export interface TicketHistoryEntry {
  id: number
  fieldId: number | null
  fieldKey: string | null
  fieldLabel: string | null
  fieldType: FieldType | null
  eventType: 'field_changed' | 'ticket_closed' | 'ticket_reopened'
  oldValue: string | null
  newValue: string | null
  changedBy: number | null
  changedByName: string | null
  changedAt: string
}

export interface CollectionTicketRow {
  id: number
  collectionResponseId: number
  ticketTemplateId: number | null
  ticketTitle: string | null
  finalized: boolean
  finalizedAt: string | null
  finalizedByName: string | null
  submitterName: string | null
  submitterEmail: string | null
  submittedAt: string | null
  values: { fieldId: number; value: string | null }[]
}

export interface ResponseTicketSummary {
  templateId: number
  title: string
  description: string | null
  displayOrder: number
  response: TicketResponse | null
}

export interface Category {
  id: number
  name: string
  sortOrder: number
  organizationId: number | null
  organizationName: string | null
}

export interface AppNotification {
  id: number
  deliveryId: number
  eventId: number
  userId: number | null
  collectionId: number | null
  collectionSlug: string | null
  targetType: 'collection' | 'submission' | 'user' | 'organization' | 'system' | null
  targetId: number | null
  type: 'due_soon' | 'overdue' | 'system'
  title: string
  message: string
  dueDate: string | null
  isRead: boolean
  createdAt: string
  readAt: string | null
  actionUrl: string | null
  channel: 'in_app' | 'email'
  recipientRole: 'primary' | 'cc'
}

export interface Location {
  id: number
  name: string
  organizationId: number
  createdAt: string
}

// ── Groups ────────────────────────────────────────────────────

export interface Group {
  id: number
  organizationId: number
  name: string
  description: string | null
  createdBy: number | null
  createdAt: string
  updatedAt: string
  memberCount?: number
}

export interface GroupMember {
  userId: number
  name: string
  email: string
  role: UserRole
  addedAt: string
}

export interface CollectionShare {
  users: Array<{ id: number; name: string; email: string }>
  groups: Array<{ id: number; name: string }>
}

// ── Sign-Up Sheets ────────────────────────────────────────────

export interface SignupSlot {
  id: number
  collectionId: number
  slotDate: string
  startTime: string
  endTime: string
  label: string
  maxCapacity: number
  sortOrder: number
  filledCount: number
  createdAt: string
}

export interface SignupRegistration {
  id: number
  slotId: number
  respondentName: string
  respondentEmail: string
  note: string | null
  createdAt: string
}

export interface SignupSheetSummary {
  id: number
  slug: string
  title: string
  description: string | null
  status: CollectionStatus
  collectionType: CollectionType
  organizationName: string | null
  instructions: string | null
  logoUrl: string | null
  coverPhotoUrl: string | null
}

