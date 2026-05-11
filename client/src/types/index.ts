export type UserRole = 'administrator' | 'team_manager' | 'user'

export interface User {
  id: number
  name: string
  email: string
  role: UserRole
  organization?: string
  createdAt: string
}

export interface AuthResponse {
  token: string
  user: User
}

// ── Collections ───────────────────────────────────────────────

export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'single_choice'
  | 'multiple_choice'
  | 'attachment'
  | 'signature'
  | 'confirmation'
  | 'custom_table'
  | 'rating'
  | 'comment'
  | 'matrix_likert_scale'

export type ColType = 'text' | 'number' | 'date' | 'checkbox' | 'list'
export type CollectionStatus = 'draft' | 'published'
export type FieldDisplayStyle = 'radio' | 'dropdown' | 'stars' | 'numbers'

export interface TableColumn {
  id?: number
  name: string
  colType: ColType
  listOptions?: string[] | null
  sortOrder: number
}

export interface CollectionField {
  id?: number
  type: FieldType
  label: string
  page: number
  required: boolean
  options: string[] | null
  displayStyle?: FieldDisplayStyle
  sortOrder: number
  tableColumns: TableColumn[] | null
}

export interface Collection {
  id: number
  slug: string
  title: string
  status: CollectionStatus
  description: string | null
  category: string | null
  createdBy: number
  createdByName: string | null
  dateDue: string | null
  coverPhotoUrl: string | null
  logoUrl: string | null
  instructions: string | null
  instructionsDocUrl: string | null
  activeVersionId?: number | null
  currentVersionNumber?: number | null
  currentVersionStatus?: CollectionStatus | null
  anonymous: boolean
  allowSubmissionEdits: boolean
  submissionEditWindowHours: number | null
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

export interface CollectionResponse {
  id: number
  respondentName: string | null
  respondentEmail: string | null
  submittedAt: string
  values: { fieldId: number; value: string | null }[]
}

export interface Category {
  id: number
  name: string
  sortOrder: number
}

export interface AppNotification {
  id: number
  userId: number
  collectionId: number
  collectionSlug: string
  type: 'due_soon' | 'overdue'
  title: string
  message: string
  dueDate: string
  isRead: boolean
  createdAt: string
  readAt: string | null
}
