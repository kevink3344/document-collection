import { z } from 'zod'

// ── Primitives ───────────────────────────────────────────────────────────────

export const positiveInt = z.number().int().positive()
export const positiveIntCoerced = z.coerce.number().int().positive()
export const nonEmptyString = z.string().trim().min(1)
export const emailString = z.string().trim().min(1).email()
export const optionalTrimmedString = z.string().trim().transform(v => v || null).pipe(z.string().nullable())
export const nullableTrimmedString = z.string().trim().nullable().optional()

// ── Roles ──────────────────────────────────────────────────────────────────

export const membershipRoleSchema = z.enum(['administrator', 'team_manager', 'reviewer', 'user'])
export const userRoleSchema = z.enum(['super_admin', 'administrator', 'team_manager', 'reviewer', 'user'])
export const invitationRoleSchema = z.enum(['administrator', 'team_manager', 'reviewer', 'user'])

// ── Auth ───────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  userId: positiveInt,
})

export const loginWithPasswordSchema = z.object({
  email: emailString,
  password: z.string().min(1, 'password is required'),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'currentPassword is required'),
  newPassword: z.string().min(8, 'newPassword must be at least 8 characters'),
})

export const forgotPasswordSchema = z.object({
  email: emailString,
})

export const resetPasswordSchema = z.object({
  token: nonEmptyString,
  newPassword: z.string().min(8, 'newPassword must be at least 8 characters'),
})

export const switchOrganizationSchema = z.object({
  organizationId: positiveInt,
})

export const registerSchema = z.object({
  name: nonEmptyString,
  email: emailString,
  role: userRoleSchema.optional().default('user'),
  organizationId: positiveInt.nullable().optional(),
})

export const authUsersQuerySchema = z.object({
  organizationId: positiveIntCoerced.optional(),
})

// ── Users ──────────────────────────────────────────────────────────────────

export const membershipInputSchema = z.object({
  organizationId: positiveInt,
  role: membershipRoleSchema,
  isDefault: z.boolean().optional().default(false),
})

export const createUserSchema = z.object({
  name: nonEmptyString,
  email: emailString,
  role: userRoleSchema.optional(),
  organizationId: positiveInt.optional(),
  memberships: z.array(membershipInputSchema).optional(),
  locationIds: z.array(positiveInt).optional(),
})

export const updateUserSchema = z.object({
  name: nonEmptyString,
  email: emailString,
  role: userRoleSchema.optional(),
  organizationId: positiveInt.optional(),
  memberships: z.array(membershipInputSchema).optional(),
})

export const updateUserLocationsSchema = z.object({
  locationIds: z.array(positiveInt),
})

export const userIdParamSchema = z.object({
  id: positiveIntCoerced,
})

// ── Organizations ──────────────────────────────────────────────────────────

export const createOrganizationSchema = z.object({
  name: nonEmptyString,
  slug: z.string().trim().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional(),
})

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional(),
})

export const deleteOrganizationSchema = z.object({
  confirmationText: z.literal('DELETE', { message: 'Type DELETE to confirm organization removal' }),
})

export const organizationIdParamSchema = z.object({
  id: positiveIntCoerced,
})

export const menuLabelsSchema = z.object({
  labels: z.record(z.string(), z.string().trim().min(1).max(40)).refine(
    val => Object.keys(val).every(k => ['dashboard', 'collections', 'records', 'reports', 'settings', 'tickets'].includes(k)),
    { message: 'Unknown label keys' }
  ),
})

// ── Categories ─────────────────────────────────────────────────────────────

export const createCategorySchema = z.object({
  name: nonEmptyString,
  organizationId: positiveInt.optional(),
})

export const categoryQuerySchema = z.object({
  organizationId: positiveIntCoerced.optional(),
})

// ── Groups ─────────────────────────────────────────────────────────────────

export const createGroupSchema = z.object({
  name: nonEmptyString,
  description: z.string().trim().nullable().optional(),
})

export const updateGroupSchema = z.object({
  name: nonEmptyString,
  description: z.string().trim().nullable().optional(),
})

export const groupIdParamSchema = z.object({
  id: positiveIntCoerced,
})

export const groupMemberParamSchema = z.object({
  id: positiveIntCoerced,
  userId: positiveIntCoerced,
})

export const addGroupMemberSchema = z.object({
  userId: positiveInt,
})

// ── Locations ──────────────────────────────────────────────────────────────

export const createLocationSchema = z.object({
  name: nonEmptyString,
})

export const locationQuerySchema = z.object({
  q: z.string().optional(),
  slug: z.string().optional(),
})

export const importLocationsSchema = z.object({
  url: z.string().trim().url().optional(),
})

// ── Settings ───────────────────────────────────────────────────────────────

export const updateVisibilitySchema = z.object({
  visiblePanelIds: z.array(z.string().trim().min(1)),
})

export const createSettingsTabSchema = z.object({
  name: nonEmptyString,
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, 'slug must contain only lowercase letters, numbers, and hyphens'),
  visibleTo: z.enum(['all', 'super_admin_only']),
})

export const reorderSettingsTabsSchema = z.object({
  orderedIds: z.array(positiveInt).min(1),
})

export const updateSettingsTabSchema = z.object({
  name: z.string().trim().min(1).optional(),
  visibleTo: z.enum(['all', 'super_admin_only']).optional(),
  sortOrder: z.number().int().optional(),
}).refine(v => v.name !== undefined || v.visibleTo !== undefined || v.sortOrder !== undefined, {
  message: 'At least one field (name, visibleTo, sortOrder) is required',
})

export const settingsTabIdParamSchema = z.object({
  id: positiveIntCoerced,
})

export const updateSettingSchema = z.object({
  value: z.string(),
})

// ── Invitations ────────────────────────────────────────────────────────────

export const createInvitationSchema = z.object({
  email: emailString,
  name: nonEmptyString,
  role: invitationRoleSchema.optional().default('user'),
})

export const acceptInvitationSchema = z.object({
  token: nonEmptyString,
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

// ── Collections ────────────────────────────────────────────────────────────

export const fieldTypeSchema = z.enum([
  'short_text', 'date', 'long_text', 'single_choice', 'multiple_choice',
  'document', 'attachment', 'signature', 'confirmation', 'custom_table',
  'rating', 'comment', 'matrix_likert_scale', 'location',
])

export const colTypeSchema = z.enum(['text', 'number', 'date', 'checkbox', 'list'])

export const tableColumnInputSchema = z.object({
  name: nonEmptyString,
  colType: colTypeSchema,
  listOptions: z.array(z.string()).optional(),
  sortOrder: z.number().int().optional(),
})

export const fieldInputSchema = z.object({
  fieldKey: z.string().trim().optional(),
  type: fieldTypeSchema,
  label: nonEmptyString,
  subtitle: z.string().trim().optional(),
  page: z.number().int().min(1).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  displayStyle: z.string().optional(),
  branchRules: z.array(z.object({
    value: z.string(),
    targetFieldKey: z.string().nullable(),
  })).optional(),
  tableColumns: z.array(tableColumnInputSchema).optional(),
  sortOrder: z.number().int().optional(),
  staffOnly: z.boolean().optional(),
  locationFilterEnabled: z.boolean().optional(),
})

export const createCollectionSchema = z.object({
  title: nonEmptyString,
  status: z.enum(['draft', 'published']).optional(),
  organizationId: positiveInt.optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  dateDue: z.string().optional(),
  coverPhotoUrl: z.string().optional(),
  coverPhotoAssetId: z.number().int().positive().nullable().optional(),
  logoUrl: z.string().optional(),
  instructions: z.string().optional(),
  instructionsDocUrl: z.string().optional(),
  anonymous: z.boolean().optional(),
  allowSubmissionEdits: z.boolean().optional(),
  submissionEditWindowHours: z.number().int().min(1).max(168).optional(),
  workflowDefinition: z.unknown().nullable().optional(),
  sourceTemplateCollectionId: z.number().int().positive().nullable().optional(),
  locationId: z.number().int().positive().nullable().optional(),
  collectionType: z.enum(['standard', 'signup_sheet']).optional(),
  fields: z.array(fieldInputSchema).optional(),
})

export const collectionIdParamSchema = z.object({
  id: positiveIntCoerced,
})

export const collectionSlugParamSchema = z.object({
  slug: nonEmptyString,
})

// ── Generic ────────────────────────────────────────────────────────────────

export const paginationQuerySchema = z.object({
  page: positiveIntCoerced.optional().default(1),
  limit: positiveIntCoerced.optional().default(20),
})
