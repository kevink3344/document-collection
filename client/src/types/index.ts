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

export type ColType = 'text' | 'number' | 'date' | 'checkbox' | 'list'
export type CollectionStatus = 'draft' | 'published'

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
  instructions: string | null
  instructionsDocUrl: string | null
  anonymous: boolean
  createdAt: string
  updatedAt: string
  fields: CollectionField[]
  responseCount?: number
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
