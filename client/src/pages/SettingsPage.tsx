import { useEffect, useState } from 'react'
import { Bell, Building2, ChevronDown, ChevronRight, Code2, Database, ExternalLink, GripVertical, Image as ImageIcon, LayoutList, Mail, MapPin, MessageSquare, Pencil, Plus, Save, Tag, Trash2, Users, X } from 'lucide-react'
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { getPreference, updatePreference } from '../api/preferences'
import {
  createOrganization,
  deleteOrganization,
  listOrganizations,
  updateOrganization,
} from '../api/organizations'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../api/categories'
import { listCollections, seedCollectionData } from '../api/collections'
import { deleteGalleryAsset, listGalleryAssets, uploadGalleryAsset } from '../api/galleryAssets'
import { getPublicSetting, updateSetting } from '../api/settings'
import { listUsers, createUser, deleteUser, updateUser, sendInvite, type AppUser } from '../api/users'
import { getUserLocations, updateUserLocations, listLocations, createLocation, deleteLocation, updateLocation } from '../api/locations'
import { LocationTypeahead } from '../components/common/LocationTypeahead'
import { useAuth } from '../contexts/AuthContext'
import type { Category, Collection, GalleryAsset, Location, MembershipRole, Organization } from '../types'
import { getCategoryColorClasses } from '../utils/categoryColors'

const INPUT =
  'w-full border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A] ' +
  'text-[#1E293B] dark:text-[#F1F5F9] placeholder-[#94A3B8] px-3 py-2 text-sm rounded ' +
  'focus:outline-none focus:ring-2 focus:ring-[#2563EB]'

// ─── Settings panel layout ─────────────────────────────────────────────────
type PanelId =
  | 'organizations'
  | 'categories'
  | 'notifications'
  | 'login-page'
  | 'navigation'
  | 'users'
  | 'locations'
  | 'gallery'
  | 'qr-code'
  | 'logo-padding'
  | 'api'
  | 'seed'

type TabId = 'general' | 'other'
type PanelLayout = Record<TabId, PanelId[]>

const SETTINGS_LAYOUT_PREF = 'settings_panel_layout'
const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  general: ['organizations', 'categories', 'notifications', 'login-page', 'navigation', 'users', 'locations', 'gallery'],
  other: ['qr-code', 'logo-padding', 'api', 'seed'],
}
const PANEL_LABELS: Record<PanelId, string> = {
  organizations: 'Organizations',
  categories: 'Categories',
  notifications: 'Notifications',
  'login-page': 'Login Page',
  navigation: 'Navigation',
  users: 'User Accounts',
  locations: 'Locations',
  gallery: 'Cover Photo Gallery',
  'qr-code': 'QR Code',
  'logo-padding': 'Image Logo URL Padding',
  api: 'API Documentation',
  seed: 'Seed Data',
}

const ALL_PANEL_IDS: PanelId[] = [
  ...DEFAULT_PANEL_LAYOUT.general,
  ...DEFAULT_PANEL_LAYOUT.other,
]

function mergeStoredLayout(stored: unknown): PanelLayout {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return DEFAULT_PANEL_LAYOUT
  const s = stored as Record<string, unknown>
  const storedGeneral = Array.isArray(s.general) ? (s.general as string[]) : []
  const storedOther = Array.isArray(s.other) ? (s.other as string[]) : []
  const storedAll = [...storedGeneral, ...storedOther]
  const missing = ALL_PANEL_IDS.filter(id => !storedAll.includes(id))
  return {
    general: [
      ...storedGeneral.filter(id => ALL_PANEL_IDS.includes(id as PanelId)),
      ...missing,
    ] as PanelId[],
    other: storedOther.filter(id => ALL_PANEL_IDS.includes(id as PanelId)) as PanelId[],
  }
}

function SettingsSortablePanel({ id, children }: { id: PanelId; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-start gap-1.5 ${isDragging ? 'opacity-40' : ''}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="mt-[14px] p-1.5 rounded cursor-grab select-none touch-none text-[#CBD5E1] dark:text-[#475569] hover:text-[#94A3B8] dark:hover:text-[#94A3B8] hover:bg-[#E2E8F0] dark:hover:bg-[#334155] opacity-0 group-hover:opacity-100 transition-opacity focus:outline-none"
        title="Drag to reorder"
        tabIndex={-1}
        aria-label={`Drag ${PANEL_LABELS[id]} panel to reorder`}
      >
        <GripVertical size={14} />
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function DroppableTabButton({
  tab,
  label,
  isActive,
  isDragging,
  onClick,
}: {
  tab: TabId
  label: string
  isActive: boolean
  isDragging: boolean
  onClick: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-tab-${tab}` })
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      className={[
        'relative px-5 py-3 text-sm font-medium border-b-2 transition-colors',
        isActive
          ? 'border-[#2563EB] text-[#2563EB] dark:text-blue-400 dark:border-blue-400'
          : 'border-transparent text-[#64748B] hover:text-[#1E293B] dark:hover:text-[#F1F5F9]',
        isDragging && !isActive && isOver
          ? 'ring-2 ring-inset ring-[#2563EB] rounded-t text-[#2563EB] dark:text-blue-400'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {label}
      {isDragging && !isActive && (
        <span
          className={`absolute inset-0 rounded-t pointer-events-none transition-colors ${
            isOver ? 'bg-blue-50 dark:bg-blue-900/20' : ''
          }`}
        />
      )}
    </button>
  )
}

// Prefer pointer-within for the tab drop zones, fall back to closestCenter for panel sorting
const tabAwareCollision: CollisionDetection = args => {
  const tabHits = pointerWithin(args).filter(c =>
    String(c.id).startsWith('drop-tab-')
  )
  if (tabHits.length > 0) return tabHits
  return closestCenter(args)
}

// ─── End settings panel layout ───────────────────────────────────────────────

function getUserRoleBadgeClass(role: AppUser['role']): string {
  return role === 'super_admin'
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    : role === 'administrator'
    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
    : role === 'team_manager'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    : role === 'reviewer'
    ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
    : 'bg-[#E2E8F0] text-[#475569] dark:bg-[#334155] dark:text-[#CBD5E1]'
}

function formatRoleLabel(role: AppUser['role']): string {
  if (role === 'super_admin') return 'super admin'
  if (role === 'team_manager') return 'team manager'
  return role
}

type EditableMembership = {
  organizationId: string
  role: MembershipRole
  isDefault: boolean
}

function createEditableMembership(role: MembershipRole = 'user'): EditableMembership {
  return {
    organizationId: '',
    role,
    isDefault: true,
  }
}

function normalizeEditableMemberships(entries: EditableMembership[]): EditableMembership[] {
  const filtered = entries.filter(entry => entry.organizationId)
  if (filtered.length === 0) {
    return entries.length > 0 ? [{ ...entries[0], isDefault: true }] : []
  }

  let sawDefault = false
  return entries.map(entry => {
    if (!entry.organizationId) {
      return { ...entry, isDefault: false }
    }

    if (entry.isDefault && !sawDefault) {
      sawDefault = true
      return entry
    }

    const isFirstFilled = !sawDefault && filtered[0].organizationId === entry.organizationId && filtered[0].role === entry.role && filtered[0].isDefault === entry.isDefault
    if (isFirstFilled) {
      sawDefault = true
      return { ...entry, isDefault: true }
    }

    return { ...entry, isDefault: false }
  })
}

function buildMembershipPayload(entries: EditableMembership[]): { organizationId: number; role: MembershipRole; isDefault: boolean }[] {
  const seen = new Set<number>()
  const normalized = normalizeEditableMemberships(entries)
  const memberships: { organizationId: number; role: MembershipRole; isDefault: boolean }[] = []

  for (const entry of normalized) {
    const organizationId = Number.parseInt(entry.organizationId, 10)
    if (!Number.isInteger(organizationId) || seen.has(organizationId)) {
      continue
    }
    seen.add(organizationId)
    memberships.push({
      organizationId,
      role: entry.role,
      isDefault: entry.isDefault,
    })
  }

  if (memberships.length > 0 && !memberships.some(entry => entry.isDefault)) {
    memberships[0].isDefault = true
  }

  return memberships
}

function organizationDisplayLabel(org: { name: string; description: string | null }) {
  return org.description?.trim() ? `${org.description} (${org.name})` : org.name
}

function summarizeUserMemberships(user: AppUser): string[] {
  if (user.organizations.length === 0) {
    return [user.organizationName ?? user.organization ?? 'No organization assigned']
  }

  return user.organizations.map(org => {
    const orgLabel = org.organizationDescription?.trim() || org.organizationName
    const roleLabel = formatRoleLabel(org.role)
    return `${orgLabel} · ${roleLabel}${org.isDefault ? ' · default' : ''}`
  })
}

function getUserAccessSummary(user: AppUser): { label: string; className: string } {
  const systemRole = user.systemRole ?? user.role
  if (systemRole === 'super_admin') {
    return {
      label: 'super admin',
      className: getUserRoleBadgeClass('super_admin'),
    }
  }

  return {
    label: 'organization member',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  }
}

export default function SettingsPage() {
  const { user } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [newCategoryName, setNewCategoryName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoriesExpanded, setCategoriesExpanded] = useState(false)
  const [qrCodeExpanded, setQrCodeExpanded] = useState(false)
  const [logoPaddingExpanded, setLogoPaddingExpanded] = useState(false)
  const [apiExpanded, setApiExpanded] = useState(false)
  const [notificationsExpanded, setNotificationsExpanded] = useState(false)
  const [loginPageExpanded, setLoginPageExpanded] = useState(false)
  const [navigationExpanded, setNavigationExpanded] = useState(false)
  const [organizationsExpanded, setOrganizationsExpanded] = useState(false)
  const [locationsExpanded, setLocationsExpanded] = useState(false)
  const [galleryExpanded, setGalleryExpanded] = useState(false)
  const [usersExpanded, setUsersExpanded] = useState(false)
  const [seedExpanded, setSeedExpanded] = useState(false)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [organizationsLoading, setOrganizationsLoading] = useState(false)
  const [newOrganizationName, setNewOrganizationName] = useState('')
  const [newOrganizationDescription, setNewOrganizationDescription] = useState('')
  const [organizationCreateSaving, setOrganizationCreateSaving] = useState(false)
  const [organizationCreateError, setOrganizationCreateError] = useState<string | null>(null)
  const [organizationSaveError, setOrganizationSaveError] = useState<string | null>(null)
  const [organizationDeleteError, setOrganizationDeleteError] = useState<string | null>(null)
  const [organizationEditSaving, setOrganizationEditSaving] = useState(false)
  const [editingOrganizationId, setEditingOrganizationId] = useState<number | null>(null)
  const [editingOrganizationName, setEditingOrganizationName] = useState('')
  const [editingOrganizationDescription, setEditingOrganizationDescription] = useState('')
    const [organizationDeleteTarget, setOrganizationDeleteTarget] = useState<Organization | null>(null)
    const [organizationDeleteConfirmation, setOrganizationDeleteConfirmation] = useState('')
    const [organizationDeleteSaving, setOrganizationDeleteSaving] = useState(false)
  const [locationsList, setLocationsList] = useState<Location[]>([])
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [newLocationName, setNewLocationName] = useState('')
  const [locationCreateSaving, setLocationCreateSaving] = useState(false)
  const [locationCreateError, setLocationCreateError] = useState<string | null>(null)
  const [locationDeleteError, setLocationDeleteError] = useState<string | null>(null)
  const [locationSaveError, setLocationSaveError] = useState<string | null>(null)
  const [locationEditSaving, setLocationEditSaving] = useState(false)
  const [editingLocationId, setEditingLocationId] = useState<number | null>(null)
  const [editingLocationName, setEditingLocationName] = useState('')
  const [galleryAssets, setGalleryAssets] = useState<GalleryAsset[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [galleryError, setGalleryError] = useState<string | null>(null)
  const [galleryUploadName, setGalleryUploadName] = useState('')
  const [galleryUploadAltText, setGalleryUploadAltText] = useState('')
  const [galleryUploadTags, setGalleryUploadTags] = useState('')
  const [galleryUploadFile, setGalleryUploadFile] = useState<File | null>(null)
  const [galleryUploadSaving, setGalleryUploadSaving] = useState(false)
  const [galleryDeleteSavingId, setGalleryDeleteSavingId] = useState<number | null>(null)
  const [allUsers, setAllUsers] = useState<AppUser[]>([])
  const [seedCollections, setSeedCollections] = useState<Collection[]>([])
  const [seedCollectionsLoading, setSeedCollectionsLoading] = useState(false)
  const [seedCollectionId, setSeedCollectionId] = useState('')
  const [seedCount, setSeedCount] = useState('20')
  const [seedSaving, setSeedSaving] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [seedSuccess, setSeedSuccess] = useState<string | null>(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState<'user' | 'super_admin'>('user')
  const [newUserMemberships, setNewUserMemberships] = useState<EditableMembership[]>([createEditableMembership()])
  const [userCreateSaving, setUserCreateSaving] = useState(false)
  const [userCreateError, setUserCreateError] = useState<string | null>(null)
  const [userCreateSuccess, setUserCreateSuccess] = useState<number | null>(null)
  const [userDeleteError, setUserDeleteError] = useState<string | null>(null)
  // Invite user
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<'user' | 'reviewer' | 'team_manager' | 'administrator'>('user')
  const [inviteSaving, setInviteSaving] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  const [editingUserName, setEditingUserName] = useState('')
  const [editingUserEmail, setEditingUserEmail] = useState('')
  const [editingUserRole, setEditingUserRole] = useState<'user' | 'super_admin'>('user')
  const [editingUserMemberships, setEditingUserMemberships] = useState<EditableMembership[]>([])
  const [userEditSaving, setUserEditSaving] = useState(false)
  const [userEditError, setUserEditError] = useState<string | null>(null)
  const [editingUserLocations, setEditingUserLocations] = useState<Location[]>([])
  const [editingUserLocationsLoading, setEditingUserLocationsLoading] = useState(false)
  const [loginSubtitle, setLoginSubtitle] = useState('')
  const [loginSubtitleDraft, setLoginSubtitleDraft] = useState('')
  const [loginSubtitleSaving, setLoginSubtitleSaving] = useState(false)
  const [loginSubtitleError, setLoginSubtitleError] = useState<string | null>(null)
  const [loginSubtitleSaved, setLoginSubtitleSaved] = useState(false)
  const [loginMessage, setLoginMessage] = useState('')
  const [loginMessageDraft, setLoginMessageDraft] = useState('')
  const [loginMessageSaving, setLoginMessageSaving] = useState(false)
  const [loginMessageError, setLoginMessageError] = useState<string | null>(null)
  const [loginMessageSaved, setLoginMessageSaved] = useState(false)
  const [reminderDays, setReminderDays] = useState('-3')
  const [reminderDaysDraft, setReminderDaysDraft] = useState('-3')
  const [lateDays, setLateDays] = useState('1')
  const [lateDaysDraft, setLateDaysDraft] = useState('1')
  const [notificationWindowSaving, setNotificationWindowSaving] = useState(false)
  const [notificationWindowError, setNotificationWindowError] = useState<string | null>(null)
  const [notificationWindowSaved, setNotificationWindowSaved] = useState(false)
  const [qrCodeEnabled, setQrCodeEnabled] = useState(false)
  const [qrCodeSaving, setQrCodeSaving] = useState(false)
  const [qrCodeError, setQrCodeError] = useState<string | null>(null)
  const [qrCodeSaved, setQrCodeSaved] = useState(false)
  const [aiSummaryEnabled, setAiSummaryEnabled] = useState(true)
  const [aiSummarySaving, setAiSummarySaving] = useState(false)
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null)
  const [aiSummarySaved, setAiSummarySaved] = useState(false)
  const [confirmationEmailsEnabled, setConfirmationEmailsEnabled] = useState(false)
  const [confirmationEmailsSaving, setConfirmationEmailsSaving] = useState(false)
  const [confirmationEmailsError, setConfirmationEmailsError] = useState<string | null>(null)
  const [confirmationEmailsSaved, setConfirmationEmailsSaved] = useState(false)
  const [copyAnswersDisclaimer, setCopyAnswersDisclaimer] = useState('')
  const [copyAnswersDisclaimerDraft, setCopyAnswersDisclaimerDraft] = useState('')
  const [copyAnswersDisclaimerSaving, setCopyAnswersDisclaimerSaving] = useState(false)
  const [copyAnswersDisclaimerError, setCopyAnswersDisclaimerError] = useState<string | null>(null)
  const [copyAnswersDisclaimerSaved, setCopyAnswersDisclaimerSaved] = useState(false)
  const [logoPaddingTop, setLogoPaddingTop] = useState('0')
  const [logoPaddingRight, setLogoPaddingRight] = useState('0')
  const [logoPaddingBottom, setLogoPaddingBottom] = useState('0')
  const [logoPaddingLeft, setLogoPaddingLeft] = useState('0')
  const [logoPaddingSaving, setLogoPaddingSaving] = useState(false)
  const [logoPaddingError, setLogoPaddingError] = useState<string | null>(null)
  const [logoPaddingSaved, setLogoPaddingSaved] = useState(false)
  // Panel layout
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [panelLayout, setPanelLayout] = useState<PanelLayout>(DEFAULT_PANEL_LAYOUT)
  const [draggingId, setDraggingId] = useState<PanelId | null>(null)

  useEffect(() => {
    getPublicSetting('login_subtitle')
      .then(val => { setLoginSubtitle(val); setLoginSubtitleDraft(val) })
      .catch(() => {})
    getPublicSetting('login_message')
      .then(val => { setLoginMessage(val); setLoginMessageDraft(val) })
      .catch(() => {})
    getPublicSetting('notification_reminder_days')
      .then(val => {
        setReminderDays(val)
        setReminderDaysDraft(val)
      })
      .catch(() => {})
    getPublicSetting('notification_late_days')
      .then(val => {
        setLateDays(val)
        setLateDaysDraft(val)
      })
      .catch(() => {})
    getPublicSetting('qr_code_enabled')
      .then(val => setQrCodeEnabled(val === 'true'))
      .catch(() => setQrCodeEnabled(false))
    getPublicSetting('ai_summary_enabled')
      .then(val => setAiSummaryEnabled(val !== 'false'))
      .catch(() => setAiSummaryEnabled(true))
    getPublicSetting('submission_confirmation_emails')
      .then(val => setConfirmationEmailsEnabled(val === 'true'))
      .catch(() => setConfirmationEmailsEnabled(false))
    getPublicSetting('copy_answers_disclaimer')
      .then(val => { setCopyAnswersDisclaimer(val); setCopyAnswersDisclaimerDraft(val) })
      .catch(() => {})
    getPublicSetting('image_logo_padding_top')
      .then(setLogoPaddingTop)
      .catch(() => setLogoPaddingTop('0'))
    getPublicSetting('image_logo_padding_right')
      .then(setLogoPaddingRight)
      .catch(() => setLogoPaddingRight('0'))
    getPublicSetting('image_logo_padding_bottom')
      .then(setLogoPaddingBottom)
      .catch(() => setLogoPaddingBottom('0'))
    getPublicSetting('image_logo_padding_left')
      .then(setLogoPaddingLeft)
      .catch(() => setLogoPaddingLeft('0'))
  }, [])

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  // For global admins: track which org's categories are being managed
  const [categoriesOrgId, setCategoriesOrgId] = useState<number | null>(null)
  const isGlobalAdmin = user?.role === 'super_admin'

  useEffect(() => {
    if (!isGlobalAdmin) return
    const targetOrgId = categoriesOrgId ?? undefined
    listCategories(targetOrgId)
      .then(setCategories)
      .catch(err => setError((err as Error).message))
  }, [isGlobalAdmin, categoriesOrgId])

  useEffect(() => {
    if (user?.role === 'administrator' || user?.role === 'super_admin') {
      loadOrganizations()
      loadUsers()
      void loadLocations()
      void loadGallery()
    }
  }, [user?.role])

  useEffect(() => {
    getPreference(SETTINGS_LAYOUT_PREF)
      .then(val => {
        if (val) {
          try {
            setPanelLayout(mergeStoredLayout(JSON.parse(val)))
          } catch {
            // ignore parse errors, use default
          }
        }
      })
      .catch(() => {})
  }, [])

  function sortOrganizationsByDescription(items: Organization[]) {
    return items.slice().sort((a, b) => {
      const aDescription = (a.description ?? '').trim()
      const bDescription = (b.description ?? '').trim()

      if (aDescription && bDescription) {
        const byDescription = aDescription.localeCompare(bDescription)
        if (byDescription !== 0) return byDescription
      } else if (aDescription || bDescription) {
        return aDescription ? -1 : 1
      }

      return a.name.localeCompare(b.name)
    })
  }

  function loadOrganizations() {
    setOrganizationsLoading(true)
    listOrganizations()
      .then(items => setOrganizations(sortOrganizationsByDescription(items)))
      .catch(err => setOrganizationCreateError((err as Error).message))
      .finally(() => setOrganizationsLoading(false))
  }

  function loadUsers() {
    setUsersLoading(true)
    listUsers()
      .then(setAllUsers)
      .catch(() => {})
      .finally(() => setUsersLoading(false))
  }

  function loadSeedCollections() {
    setSeedCollectionsLoading(true)
    listCollections()
      .then(cols => {
        setSeedCollections(cols)
        setSeedCollectionId(current => current || String(cols[0]?.id ?? ''))
      })
      .catch(err => setSeedError((err as Error).message))
      .finally(() => setSeedCollectionsLoading(false))
  }

  async function handleSendInvite() {
    const email = inviteEmail.trim()
    const name = inviteName.trim()
    if (!email || !name) return
    setInviteSaving(true)
    setInviteError(null)
    setInviteSuccess(null)
    setInviteLink(null)
    try {
      const result = await sendInvite({ email, name, role: inviteRole })
      setInviteSuccess(result.message)
      setInviteLink(result.inviteLink ?? null)
      setInviteEmail('')
      setInviteName('')
      setInviteRole('user')
    } catch (err) {
      setInviteError((err as Error).message)
    } finally {
      setInviteSaving(false)
    }
  }

  async function handleCreateUser() {
    const name = newUserName.trim()
    const email = newUserEmail.trim()
    const memberships = buildMembershipPayload(newUserMemberships)
    const isSuperAdmin = newUserRole === 'super_admin'
    if (!name || !email) return
    if (!isSuperAdmin && memberships.length === 0) {
      setUserCreateError('At least one organization membership is required.')
      return
    }
    setUserCreateSaving(true)
    setUserCreateError(null)
    setUserCreateSuccess(null)
    try {
      const created = await createUser({
        name,
        email,
        role: isSuperAdmin ? 'super_admin' : memberships.find(entry => entry.isDefault)?.role ?? memberships[0].role,
        memberships: isSuperAdmin ? [] : memberships,
      })
      setAllUsers(prev => [...prev, created])
      setUserCreateSuccess(created.id)
      setNewUserName('')
      setNewUserEmail('')
      setNewUserRole('user')
      setNewUserMemberships([createEditableMembership()])
    } catch (err) {
      setUserCreateError((err as Error).message)
    } finally {
      setUserCreateSaving(false)
    }
  }

  async function handleDeleteUser(id: number) {
    setUserDeleteError(null)
    try {
      await deleteUser(id)
      setAllUsers(prev => prev.filter(u => u.id !== id))
      if (userCreateSuccess === id) setUserCreateSuccess(null)
      if (editingUserId === id) {
        setEditingUserId(null)
        setEditingUserName('')
        setEditingUserEmail('')
        setEditingUserRole('user')
        setEditingUserMemberships([])
      }
    } catch (err) {
      setUserDeleteError((err as Error).message)
    }
  }

  async function handleCreateOrganization() {
    const name = newOrganizationName.trim()
    const description = newOrganizationDescription.trim()
    if (!name) return

    setOrganizationCreateSaving(true)
    setOrganizationCreateError(null)
    try {
      const created = await createOrganization({
        name,
        description: description || undefined,
      })
      setOrganizations(prev => sortOrganizationsByDescription([...prev, created]))
      setNewOrganizationName('')
      setNewOrganizationDescription('')
    } catch (err) {
      setOrganizationCreateError((err as Error).message)
    } finally {
      setOrganizationCreateSaving(false)
    }
  }

  function startOrganizationEdit(org: Organization) {
    setEditingOrganizationId(org.id)
    setEditingOrganizationName(org.name)
    setEditingOrganizationDescription(org.description ?? '')
    setOrganizationSaveError(null)
    setOrganizationDeleteError(null)
  }

  function cancelOrganizationEdit() {
    setEditingOrganizationId(null)
    setEditingOrganizationName('')
    setEditingOrganizationDescription('')
    setOrganizationSaveError(null)
  }

    function startOrganizationDelete(org: Organization) {
      setOrganizationDeleteTarget(org)
      setOrganizationDeleteConfirmation('')
      setOrganizationDeleteError(null)
    }

    function cancelOrganizationDelete() {
      setOrganizationDeleteTarget(null)
      setOrganizationDeleteConfirmation('')
      setOrganizationDeleteError(null)
    }

  async function handleSaveOrganization(id: number) {
    const name = editingOrganizationName.trim()
    if (!name) {
      setOrganizationSaveError('Organization name is required.')
      return
    }

    setOrganizationEditSaving(true)
    setOrganizationSaveError(null)
    try {
      const updated = await updateOrganization(id, {
        name,
        description: editingOrganizationDescription.trim() || undefined,
      })
      setOrganizations(prev => sortOrganizationsByDescription(prev.map(org => (org.id === id ? updated : org))))
      setAllUsers(prev => prev.map(existing => (
        existing.organizationId === updated.id || existing.organizations.some(org => org.organizationId === updated.id)
          ? {
              ...existing,
              organizationName: existing.organizationId === updated.id ? updated.name : existing.organizationName,
              organization: existing.organizationId === updated.id ? updated.name : existing.organization,
              organizations: existing.organizations.map(org => (
                org.organizationId === updated.id
                  ? {
                      ...org,
                      organizationName: updated.name,
                      organizationDescription: updated.description,
                    }
                  : org
              )),
            }
          : existing
      )))
      cancelOrganizationEdit()
    } catch (err) {
      setOrganizationSaveError((err as Error).message)
    } finally {
      setOrganizationEditSaving(false)
    }
  }

  async function handleDeleteOrganization(id: number) {
    setOrganizationDeleteError(null)
      setOrganizationDeleteSaving(true)
    try {
        await deleteOrganization(id, organizationDeleteConfirmation)
      setOrganizations(prev => prev.filter(org => org.id !== id))
      setNewUserMemberships(prev => normalizeEditableMemberships(prev.map(entry => (
        entry.organizationId === String(id) ? { ...entry, organizationId: '' } : entry
      ))))
      setEditingUserMemberships(prev => normalizeEditableMemberships(prev.map(entry => (
        entry.organizationId === String(id) ? { ...entry, organizationId: '' } : entry
      ))))
      if (editingOrganizationId === id) {
        cancelOrganizationEdit()
      }
      cancelOrganizationDelete()
    } catch (err) {
      setOrganizationDeleteError((err as Error).message)
    } finally {
      setOrganizationDeleteSaving(false)
    }
  }

  async function loadLocations() {
    setLocationsLoading(true)
    try {
      const locs = await listLocations()
      setLocationsList(locs)
    } catch (_) {
      // silent
    } finally {
      setLocationsLoading(false)
    }
  }

  async function loadGallery() {
    setGalleryLoading(true)
    setGalleryError(null)
    try {
      const items = await listGalleryAssets()
      setGalleryAssets(items)
    } catch (err) {
      setGalleryError((err as Error).message)
    } finally {
      setGalleryLoading(false)
    }
  }

  async function handleGalleryUpload() {
    if (!galleryUploadFile) {
      setGalleryError('Please select an image to upload.')
      return
    }

    const name = galleryUploadName.trim() || galleryUploadFile.name
    setGalleryUploadSaving(true)
    setGalleryError(null)
    try {
      const created = await uploadGalleryAsset({
        file: galleryUploadFile,
        name,
        altText: galleryUploadAltText,
        tags: galleryUploadTags,
      })
      setGalleryAssets(prev => [created, ...prev])
      setGalleryUploadName('')
      setGalleryUploadAltText('')
      setGalleryUploadTags('')
      setGalleryUploadFile(null)
    } catch (err) {
      setGalleryError((err as Error).message)
    } finally {
      setGalleryUploadSaving(false)
    }
  }

  async function handleGalleryDelete(id: number) {
    setGalleryDeleteSavingId(id)
    setGalleryError(null)
    try {
      await deleteGalleryAsset(id)
      setGalleryAssets(prev => prev.filter(asset => asset.id !== id))
    } catch (err) {
      setGalleryError((err as Error).message)
    } finally {
      setGalleryDeleteSavingId(null)
    }
  }

  async function handleCreateLocation() {
    const name = newLocationName.trim()
    if (!name) {
      setLocationCreateError('Location name is required.')
      return
    }
    setLocationCreateSaving(true)
    setLocationCreateError(null)
    try {
      const created = await createLocation(name)
      setLocationsList(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setNewLocationName('')
    } catch (err) {
      setLocationCreateError((err as Error).message)
    } finally {
      setLocationCreateSaving(false)
    }
  }

  function startLocationEdit(loc: Location) {
    setEditingLocationId(loc.id)
    setEditingLocationName(loc.name)
    setLocationSaveError(null)
    setLocationDeleteError(null)
  }

  function cancelLocationEdit() {
    setEditingLocationId(null)
    setEditingLocationName('')
    setLocationSaveError(null)
  }

  async function handleSaveLocation(id: number) {
    const name = editingLocationName.trim()
    if (!name) {
      setLocationSaveError('Location name is required.')
      return
    }
    setLocationEditSaving(true)
    setLocationSaveError(null)
    try {
      const updated = await updateLocation(id, name)
      setLocationsList(prev => prev.map(l => (l.id === id ? updated : l)).sort((a, b) => a.name.localeCompare(b.name)))
      cancelLocationEdit()
    } catch (err) {
      setLocationSaveError((err as Error).message)
    } finally {
      setLocationEditSaving(false)
    }
  }

  async function handleDeleteLocation(id: number) {
    setLocationDeleteError(null)
    try {
      await deleteLocation(id)
      setLocationsList(prev => prev.filter(l => l.id !== id))
      if (editingLocationId === id) cancelLocationEdit()
    } catch (err) {
      setLocationDeleteError((err as Error).message)
    }
  }

  async function handleSeedCollection() {
    const collectionId = parseInt(seedCollectionId, 10)
    const count = parseInt(seedCount.trim(), 10)

    if (!Number.isInteger(collectionId)) {
      setSeedError('Select a collection to seed.')
      return
    }

    if (!Number.isInteger(count) || count < 1 || count > 20) {
      setSeedError('Seed count must be a whole number between 1 and 20.')
      return
    }

    setSeedSaving(true)
    setSeedError(null)
    setSeedSuccess(null)
    try {
      const result = await seedCollectionData(collectionId, { count })
      setSeedSuccess(`Created ${result.created} seeded submissions for ${result.collectionTitle}.`)
      loadSeedCollections()
    } catch (err) {
      setSeedError((err as Error).message)
    } finally {
      setSeedSaving(false)
    }
  }

  async function handleQrCodeToggle(nextValue: boolean) {
    setQrCodeEnabled(nextValue)
    setQrCodeSaving(true)
    setQrCodeError(null)
    setQrCodeSaved(false)
    try {
      await updateSetting('qr_code_enabled', nextValue ? 'true' : 'false')
      setQrCodeSaved(true)
    } catch (err) {
      setQrCodeEnabled(!nextValue)
      setQrCodeError((err as Error).message)
    } finally {
      setQrCodeSaving(false)
    }
  }

  async function handleAiSummaryToggle(nextValue: boolean) {
    setAiSummaryEnabled(nextValue)
    setAiSummarySaving(true)
    setAiSummaryError(null)
    setAiSummarySaved(false)
    try {
      await updateSetting('ai_summary_enabled', nextValue ? 'true' : 'false')
      setAiSummarySaved(true)
    } catch (err) {
      setAiSummaryEnabled(!nextValue)
      setAiSummaryError((err as Error).message)
    } finally {
      setAiSummarySaving(false)
    }
  }

  async function handleConfirmationEmailsToggle(nextValue: boolean) {
    setConfirmationEmailsEnabled(nextValue)
    setConfirmationEmailsSaving(true)
    setConfirmationEmailsError(null)
    setConfirmationEmailsSaved(false)
    try {
      await updateSetting('submission_confirmation_emails', nextValue ? 'true' : 'false')
      setConfirmationEmailsSaved(true)
    } catch (err) {
      setConfirmationEmailsEnabled(!nextValue)
      setConfirmationEmailsError((err as Error).message)
    } finally {
      setConfirmationEmailsSaving(false)
    }
  }

  async function handleSaveCopyAnswersDisclaimer() {
    const next = copyAnswersDisclaimerDraft.trim()
    if (!next) return
    setCopyAnswersDisclaimerSaving(true)
    setCopyAnswersDisclaimerError(null)
    setCopyAnswersDisclaimerSaved(false)
    try {
      await updateSetting('copy_answers_disclaimer', next)
      setCopyAnswersDisclaimer(next)
      setCopyAnswersDisclaimerDraft(next)
      setCopyAnswersDisclaimerSaved(true)
    } catch (err) {
      setCopyAnswersDisclaimerError((err as Error).message)
    } finally {
      setCopyAnswersDisclaimerSaving(false)
    }
  }

  async function handleSaveLogoPadding() {
    const rawValues = [
      logoPaddingTop.trim(),
      logoPaddingRight.trim(),
      logoPaddingBottom.trim(),
      logoPaddingLeft.trim(),
    ]
    const parsedValues = rawValues.map(value => Number(value))

    if (parsedValues.some(value => !Number.isFinite(value) || value < 0 || !Number.isInteger(value))) {
      setLogoPaddingError('Padding values must be whole numbers greater than or equal to 0.')
      return
    }

    setLogoPaddingSaving(true)
    setLogoPaddingError(null)
    setLogoPaddingSaved(false)
    try {
      await updateSetting('image_logo_padding_top', String(parsedValues[0]))
      await updateSetting('image_logo_padding_right', String(parsedValues[1]))
      await updateSetting('image_logo_padding_bottom', String(parsedValues[2]))
      await updateSetting('image_logo_padding_left', String(parsedValues[3]))
      setLogoPaddingTop(String(parsedValues[0]))
      setLogoPaddingRight(String(parsedValues[1]))
      setLogoPaddingBottom(String(parsedValues[2]))
      setLogoPaddingLeft(String(parsedValues[3]))
      setLogoPaddingSaved(true)
    } catch (err) {
      setLogoPaddingError((err as Error).message)
    } finally {
      setLogoPaddingSaving(false)
    }
  }

  function startUserEdit(u: AppUser) {
    setEditingUserId(u.id)
    setEditingUserName(u.name)
    setEditingUserEmail(u.email)
    setEditingUserRole((u.systemRole ?? u.role) === 'super_admin' ? 'super_admin' : 'user')
    setEditingUserMemberships(
      u.organizations.length > 0
        ? normalizeEditableMemberships(u.organizations.map(org => ({
            organizationId: String(org.organizationId),
            role: org.role,
            isDefault: org.isDefault,
          })))
        : [createEditableMembership()]
    )
    setUserEditError(null)
    setUserDeleteError(null)
    setEditingUserLocations([])
    if (u.role === 'reviewer') {
      setEditingUserLocationsLoading(true)
      getUserLocations(u.id)
        .then(locs => setEditingUserLocations(locs))
        .catch(() => { /* silent — locations stay empty */ })
        .finally(() => setEditingUserLocationsLoading(false))
    }
  }

  function cancelUserEdit() {
    setEditingUserId(null)
    setEditingUserName('')
    setEditingUserEmail('')
    setEditingUserRole('user')
    setEditingUserMemberships([])
    setUserEditError(null)
    setEditingUserLocations([])
  }

  async function handleSaveUser(id: number) {
    const name = editingUserName.trim()
    const email = editingUserEmail.trim()
    const memberships = buildMembershipPayload(editingUserMemberships)
    const isSuperAdmin = editingUserRole === 'super_admin'
    if (!name || !email) {
      setUserEditError('Name and email are required.')
      return
    }
    if (!isSuperAdmin && memberships.length === 0) {
      setUserEditError('At least one organization membership is required.')
      return
    }

    setUserEditSaving(true)
    setUserEditError(null)
    try {
      const updated = await updateUser(id, {
        name,
        email,
        role: isSuperAdmin ? 'super_admin' : memberships.find(entry => entry.isDefault)?.role ?? memberships[0].role,
        memberships: isSuperAdmin ? [] : memberships,
      })
      const reviewerMembership = memberships.some(entry => entry.role === 'reviewer')
      if (!isSuperAdmin && reviewerMembership) {
        await updateUserLocations(id, editingUserLocations.map(l => l.id))
      }
      setAllUsers(prev => prev.map(u => (u.id === id ? updated : u)))
      cancelUserEdit()
    } catch (err) {
      setUserEditError((err as Error).message)
    } finally {
      setUserEditSaving(false)
    }
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim()
    if (!name) return
    if (isGlobalAdmin && categoriesOrgId == null) return

    setSaving(true)
    setError(null)
    try {
      const created = await createCategory(name, isGlobalAdmin ? (categoriesOrgId ?? undefined) : undefined)
      setCategories(prev => [...prev, created])
      setNewCategoryName('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveCategory(id: number) {
    const name = editingName.trim()
    if (!name) return

    setSaving(true)
    setError(null)
    try {
      const updated = await updateCategory(id, name)
      setCategories(prev => prev.map(category => (category.id === id ? updated : category)))
      setEditingId(null)
      setEditingName('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCategory(id: number) {
    setSaving(true)
    setError(null)
    try {
      await deleteCategory(id)
      setCategories(prev => prev.filter(category => category.id !== id))
      if (editingId === id) {
        setEditingId(null)
        setEditingName('')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  function getTabForPanel(id: PanelId): TabId {
    return panelLayout.other.includes(id) ? 'other' : 'general'
  }

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(event.active.id as PanelId)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setDraggingId(null)
    if (!over) return
    const activeId = active.id as PanelId
    const overId = over.id as string
    // Dropped on a tab drop zone
    if (overId === 'drop-tab-general' || overId === 'drop-tab-other') {
      const targetTab: TabId = overId === 'drop-tab-general' ? 'general' : 'other'
      const sourceTab = getTabForPanel(activeId)
      if (sourceTab === targetTab) return
      const newLayout: PanelLayout = {
        general: panelLayout.general.filter(id => id !== activeId),
        other: panelLayout.other.filter(id => id !== activeId),
      }
      newLayout[targetTab] = [...newLayout[targetTab], activeId]
      setPanelLayout(newLayout)
      setActiveTab(targetTab)
      updatePreference(SETTINGS_LAYOUT_PREF, JSON.stringify(newLayout)).catch(() => {})
      return
    }
    // Dropped on a specific panel
    const overPanel = overId as PanelId
    const sourceTab = getTabForPanel(activeId)
    const overTab = getTabForPanel(overPanel)
    if (sourceTab !== overTab) {
      // Cross-tab via panel drop
      const sourceList = panelLayout[sourceTab].filter(id => id !== activeId)
      const targetList = [...panelLayout[overTab]]
      const overIndex = targetList.indexOf(overPanel)
      targetList.splice(overIndex >= 0 ? overIndex : targetList.length, 0, activeId)
      const newLayout: PanelLayout = { ...panelLayout, [sourceTab]: sourceList, [overTab]: targetList }
      setPanelLayout(newLayout)
      setActiveTab(overTab)
      updatePreference(SETTINGS_LAYOUT_PREF, JSON.stringify(newLayout)).catch(() => {})
      return
    }
    if (activeId === overPanel) return
    const list = panelLayout[sourceTab]
    const oldIndex = list.indexOf(activeId)
    const newIndex = list.indexOf(overPanel)
    if (oldIndex === -1 || newIndex === -1) return
    const newList = arrayMove(list, oldIndex, newIndex)
    const newLayout: PanelLayout = { ...panelLayout, [sourceTab]: newList }
    setPanelLayout(newLayout)
    updatePreference(SETTINGS_LAYOUT_PREF, JSON.stringify(newLayout)).catch(() => {})
  }

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-[#64748B]">Loading settings…</div>
  }

  if (user?.role !== 'administrator' && user?.role !== 'super_admin') {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-4 text-amber-700 dark:text-amber-300 text-sm">
        Only administrators can manage categories.
      </div>
    )
  }

  const selectedSeedCollection = seedCollections.find(collection => String(collection.id) === seedCollectionId) ?? null
  const organizationOptions = organizations.filter(org => org.isActive)
  const editingUser = editingUserId == null ? null : allUsers.find(existingUser => existingUser.id === editingUserId) ?? null

  const renderMembershipEditor = (
    memberships: EditableMembership[],
    setMemberships: React.Dispatch<React.SetStateAction<EditableMembership[]>>,
    isDisabled: boolean,
  ) => (
    <div className="space-y-2">
      {memberships.map((membership, index) => (
        <div key={`${membership.organizationId}-${index}`} className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-2 rounded border border-[#E2E8F0] dark:border-[#334155] p-3">
          <select
            value={membership.organizationId}
            onChange={e => {
              const next = memberships.map((entry, entryIndex) => (
                entryIndex === index ? { ...entry, organizationId: e.target.value } : entry
              ))
              setMemberships(normalizeEditableMemberships(next))
            }}
            disabled={isDisabled}
            className={INPUT}
          >
            <option value="">Select organization</option>
            {organizationOptions.map(org => (
              <option key={org.id} value={String(org.id)}>{organizationDisplayLabel(org)}</option>
            ))}
          </select>
          <select
            value={membership.role}
            onChange={e => {
              const next = memberships.map((entry, entryIndex) => (
                entryIndex === index ? { ...entry, role: e.target.value as MembershipRole } : entry
              ))
              setMemberships(normalizeEditableMemberships(next))
            }}
            disabled={isDisabled}
            className={INPUT}
          >
            <option value="user">User</option>
            <option value="reviewer">Reviewer</option>
            <option value="team_manager">Team Manager</option>
            <option value="administrator">Administrator</option>
          </select>
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => {
              const next = memberships.map((entry, entryIndex) => ({
                ...entry,
                isDefault: entryIndex === index,
              }))
              setMemberships(normalizeEditableMemberships(next))
            }}
            className={`inline-flex items-center justify-center rounded border px-3 py-2 text-xs font-medium transition-colors ${membership.isDefault ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8] dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300' : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]'}`}
          >
            Default
          </button>
          <button
            type="button"
            disabled={isDisabled || memberships.length === 1}
            onClick={() => {
              const next = memberships.filter((_, entryIndex) => entryIndex !== index)
              setMemberships(normalizeEditableMemberships(next.length > 0 ? next : [createEditableMembership()]))
            }}
            className="inline-flex items-center justify-center rounded border border-[#FCA5A5] px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => setMemberships(prev => [...normalizeEditableMemberships(prev), { ...createEditableMembership(), isDefault: false }])}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#2563EB] hover:text-blue-700 disabled:opacity-50"
      >
        <Plus size={14} />
        Add membership
      </button>
    </div>
  )

  function renderPanel(id: PanelId): React.ReactNode {
    switch (id) {
      case 'categories': return (
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setCategoriesExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] dark:bg-blue-900/30 dark:text-blue-300">
              <Tag size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Categories</h2>
              <p className="text-sm text-[#64748B] mt-1">Collections use this list as the category dropdown.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs font-medium text-[#64748B]">{categories.length} total</span>
            {categoriesExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {categoriesExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-5">

            {/* Global admin: org selector */}
            {isGlobalAdmin && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[#475569] dark:text-[#CBD5E1]">
                  Managing categories for
                </label>
                <select
                  value={categoriesOrgId ?? ''}
                  onChange={e => {
                    const val = e.target.value
                    setCategoriesOrgId(val === '' ? null : parseInt(val, 10))
                  }}
                  className="w-full sm:w-72 rounded-md border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#0F172A] text-sm text-[#1E293B] dark:text-[#F1F5F9] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                >
                  <option value="">All organizations (read-only)</option>
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
                {categoriesOrgId == null && (
                  <p className="text-xs text-[#94A3B8]">Select an organization to add or edit categories.</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {categories.map(category => {
                const colors = getCategoryColorClasses(category.name)
                return (
                  <span
                    key={`badge-${category.id}`}
                    className={`inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1 text-xs font-semibold ${colors.badge}`}
                  >
                    <Tag size={12} />
                    {category.name}
                    {isGlobalAdmin && categoriesOrgId == null && category.organizationName && (
                      <span className="opacity-60 font-normal">({category.organizationName})</span>
                    )}
                  </span>
                )
              })}
            </div>

            {/* Add category — hidden for global admin unless an org is selected */}
            {(!isGlobalAdmin || categoriesOrgId != null) && (
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  placeholder="Add a new category"
                  className={INPUT}
                />
                <button
                  type="button"
                  onClick={handleCreateCategory}
                  disabled={saving || !newCategoryName.trim()}
                  className="inline-flex items-center justify-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>
            )}

            <div className="space-y-3">
              {categories.map(category => {
                const isEditing = editingId === category.id
                const colors = getCategoryColorClasses(category.name)
                // Org-scoped admins can only edit; global admin in all-orgs view = read-only
                const canEdit = !isGlobalAdmin || categoriesOrgId != null
                return (
                  <div
                    key={category.id}
                    className={`flex flex-col gap-3 rounded-lg border ${colors.card} bg-[#F8FAFC] dark:bg-[#0F172A] p-4 sm:flex-row sm:items-center`}
                  >
                    <div className="flex-1">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          className={INPUT}
                        />
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1 text-xs font-semibold ${colors.badge}`}>
                            <Tag size={12} />
                            {category.name}
                          </span>
                          {isGlobalAdmin && categoriesOrgId == null && category.organizationName && (
                            <span className="text-xs text-[#94A3B8]">{category.organizationName}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {canEdit && (
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleSaveCategory(category.id)}
                            disabled={saving || !editingName.trim()}
                            className="inline-flex items-center gap-1.5 bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded transition-colors"
                          >
                            <Save size={14} />
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null)
                              setEditingName('')
                            }}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#CBD5E1] text-sm font-medium px-3 py-2 rounded hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] transition-colors"
                          >
                            <X size={14} />
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(category.id)
                            setEditingName(category.name)
                          }}
                          disabled={saving}
                          className="inline-flex items-center gap-1.5 border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#CBD5E1] text-sm font-medium px-3 py-2 rounded hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] transition-colors"
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => void handleDeleteCategory(category.id)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium px-3 py-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>
      )
      case 'qr-code': return (
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setQrCodeExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] dark:bg-blue-900/30 dark:text-blue-300">
              <Code2 size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">QR Code</h2>
              <p className="text-sm text-[#64748B] mt-1">Show or hide the survey link QR code at the bottom of the public Instructions tab.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {qrCodeExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {qrCodeExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-4">
            <label className="flex items-center justify-between gap-4 rounded-lg border border-[#E2E8F0] dark:border-[#334155] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">Show QR code on survey instructions</p>
                <p className="text-xs text-[#64748B] mt-1">Respondents can scan the QR code to open the same survey link on another device.</p>
              </div>
              <input
                type="checkbox"
                checked={qrCodeEnabled}
                onChange={e => {
                  void handleQrCodeToggle(e.target.checked)
                }}
                disabled={qrCodeSaving}
                className="h-4 w-4 accent-[#2563EB]"
              />
            </label>

            {qrCodeError && (
              <p className="text-sm text-red-500">{qrCodeError}</p>
            )}

            <div className="flex items-center gap-3">
              {qrCodeSaving && (
                <span className="text-sm text-[#64748B]">Saving…</span>
              )}
              {qrCodeSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
              )}
            </div>
          </div>
        )}
      </section>
      )
      case 'logo-padding': return (
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setLogoPaddingExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] dark:bg-blue-900/30 dark:text-blue-300">
              <Code2 size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Image Logo URL Padding</h2>
              <p className="text-sm text-[#64748B] mt-1">Set individual logo padding values for the survey logo wrapper. Defaults are 0 on all sides.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {logoPaddingExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {logoPaddingExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">Top</label>
                <input type="number" min={0} value={logoPaddingTop} onChange={e => { setLogoPaddingTop(e.target.value); setLogoPaddingSaved(false); setLogoPaddingError(null) }} className={INPUT} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">Right</label>
                <input type="number" min={0} value={logoPaddingRight} onChange={e => { setLogoPaddingRight(e.target.value); setLogoPaddingSaved(false); setLogoPaddingError(null) }} className={INPUT} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">Bottom</label>
                <input type="number" min={0} value={logoPaddingBottom} onChange={e => { setLogoPaddingBottom(e.target.value); setLogoPaddingSaved(false); setLogoPaddingError(null) }} className={INPUT} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">Left</label>
                <input type="number" min={0} value={logoPaddingLeft} onChange={e => { setLogoPaddingLeft(e.target.value); setLogoPaddingSaved(false); setLogoPaddingError(null) }} className={INPUT} />
              </div>
            </div>

            {logoPaddingError && (
              <p className="text-sm text-red-500">{logoPaddingError}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={logoPaddingSaving}
                onClick={() => void handleSaveLogoPadding()}
                className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                <Save size={14} />
                {logoPaddingSaving ? 'Saving…' : 'Save Logo Padding'}
              </button>
              {logoPaddingSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
              )}
            </div>
          </div>
        )}
      </section>
      )
      case 'api': return (
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setApiExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] dark:bg-blue-900/30 dark:text-blue-300">
              <Code2 size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">API Documentation</h2>
              <p className="text-sm text-[#64748B] mt-1">Interactive Swagger UI for exploring and testing the REST API.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {apiExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {apiExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-4">
            <p className="text-sm text-[#475569] dark:text-[#94A3B8]">
              The Swagger UI provides a full interactive reference for all available API endpoints,
              including authentication, collections, categories, and responses.
            </p>
            <a
              href={`${window.location.protocol}//${window.location.hostname}:4000/api-docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#2563EB] hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
            >
              <Code2 size={14} />
              Open Swagger UI
              <ExternalLink size={12} />
            </a>
          </div>
        )}
      </section>
      )
      case 'notifications': return (
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setNotificationsExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] dark:bg-blue-900/30 dark:text-blue-300">
              <Bell size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Notifications</h2>
              <p className="text-sm text-[#64748B] mt-1">Configure reminder and late offsets for in-app due date notifications.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {notificationsExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {notificationsExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-5">

            {/* Confirmation emails toggle */}
            <div>
              <p className="text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                Confirmation Emails
              </p>
              <label className="flex items-center justify-between gap-4 rounded-lg border border-[#E2E8F0] dark:border-[#334155] px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">Send confirmation email to respondents</p>
                  <p className="text-xs text-[#64748B] mt-1">
                    When enabled, respondents receive an email receipt after submitting a non-anonymous collection.
                    Requires SMTP to be configured.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={confirmationEmailsEnabled}
                  onChange={e => { void handleConfirmationEmailsToggle(e.target.checked) }}
                  disabled={confirmationEmailsSaving}
                  className="h-4 w-4 accent-[#2563EB] shrink-0"
                />
              </label>
              {confirmationEmailsError && (
                <p className="text-sm text-red-500 mt-2">{confirmationEmailsError}</p>
              )}
              {confirmationEmailsSaved && (
                <p className="text-sm text-green-600 dark:text-green-400 mt-2">Saved!</p>
              )}
            </div>

            {/* Copy-of-answers disclaimer */}
            <div>
              <p className="text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                Copy of Answers Disclaimer
              </p>
              <p className="text-xs text-[#64748B] mb-2">
                This text is shown to respondents below the "Send me a copy of my answers" email field.
              </p>
              <textarea
                rows={3}
                value={copyAnswersDisclaimerDraft}
                onChange={e => { setCopyAnswersDisclaimerDraft(e.target.value); setCopyAnswersDisclaimerSaved(false) }}
                className={`${INPUT} resize-y`}
                placeholder="For privacy your email will not be saved by the system. It will only be used for this purpose."
              />
              {copyAnswersDisclaimerError && (
                <p className="text-sm text-red-500 mt-2">{copyAnswersDisclaimerError}</p>
              )}
              <div className="flex items-center gap-3 mt-2">
                <button
                  type="button"
                  disabled={copyAnswersDisclaimerSaving || copyAnswersDisclaimerDraft.trim() === copyAnswersDisclaimer}
                  onClick={() => { void handleSaveCopyAnswersDisclaimer() }}
                  className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                >
                  <Save size={14} />
                  {copyAnswersDisclaimerSaving ? 'Saving…' : 'Save Disclaimer'}
                </button>
                {copyAnswersDisclaimerSaved && (
                  <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
                )}
              </div>
            </div>

            <hr className="border-[#E2E8F0] dark:border-[#334155]" />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                  Reminder Offset (days)
                </label>
                <input
                  type="number"
                  value={reminderDaysDraft}
                  onChange={e => { setReminderDaysDraft(e.target.value); setNotificationWindowSaved(false) }}
                  className={INPUT}
                  placeholder="-3"
                />
                <p className="text-xs text-[#64748B] mt-1">Example: -3 sends reminder three days before due date.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                  Late Offset (days)
                </label>
                <input
                  type="number"
                  value={lateDaysDraft}
                  onChange={e => { setLateDaysDraft(e.target.value); setNotificationWindowSaved(false) }}
                  className={INPUT}
                  placeholder="1"
                />
                <p className="text-xs text-[#64748B] mt-1">Example: 1 sends late notice one day after due date.</p>
              </div>
            </div>

            {notificationWindowError && (
              <p className="text-sm text-red-500">{notificationWindowError}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={notificationWindowSaving || (reminderDaysDraft.trim() === reminderDays && lateDaysDraft.trim() === lateDays)}
                onClick={async () => {
                  const nextReminder = parseInt(reminderDaysDraft.trim(), 10)
                  const nextLate = parseInt(lateDaysDraft.trim(), 10)

                  if (!Number.isInteger(nextReminder) || !Number.isInteger(nextLate)) {
                    setNotificationWindowError('Offsets must be whole numbers (e.g., -3 and 1).')
                    return
                  }

                  setNotificationWindowSaving(true)
                  setNotificationWindowError(null)
                  try {
                    await updateSetting('notification_reminder_days', String(nextReminder))
                    await updateSetting('notification_late_days', String(nextLate))
                    setReminderDays(String(nextReminder))
                    setLateDays(String(nextLate))
                    setReminderDaysDraft(String(nextReminder))
                    setLateDaysDraft(String(nextLate))
                    setNotificationWindowSaved(true)
                  } catch (err) {
                    setNotificationWindowError((err as Error).message)
                  } finally {
                    setNotificationWindowSaving(false)
                  }
                }}
                className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                <Bell size={14} />
                {notificationWindowSaving ? 'Saving…' : 'Save Notification Window'}
              </button>
              {notificationWindowSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
              )}
            </div>
          </div>
        )}
      </section>
      )
      case 'login-page': return (
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setLoginPageExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] dark:bg-blue-900/30 dark:text-blue-300">
              <MessageSquare size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Login Page</h2>
              <p className="text-sm text-[#64748B] mt-1">Customize the message displayed on the sign-in screen.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {loginPageExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {loginPageExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-5">
            {/* Subtitle badge */}
            <div>
              <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                Subtitle Badge
              </label>
              <input
                type="text"
                value={loginSubtitleDraft}
                onChange={e => { setLoginSubtitleDraft(e.target.value); setLoginSubtitleSaved(false) }}
                className={INPUT}
                placeholder="e.g. Enterprise Staff Support"
              />
            </div>

            {loginSubtitleError && (
              <p className="text-sm text-red-500">{loginSubtitleError}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={loginSubtitleSaving || loginSubtitleDraft.trim() === loginSubtitle}
                onClick={async () => {
                  const val = loginSubtitleDraft.trim()
                  if (!val) return
                  setLoginSubtitleSaving(true)
                  setLoginSubtitleError(null)
                  try {
                    await updateSetting('login_subtitle', val)
                    setLoginSubtitle(val)
                    setLoginSubtitleSaved(true)
                  } catch (err) {
                    setLoginSubtitleError((err as Error).message)
                  } finally {
                    setLoginSubtitleSaving(false)
                  }
                }}
                className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                <MessageSquare size={14} />
                {loginSubtitleSaving ? 'Saving…' : 'Save Subtitle'}
              </button>
              {loginSubtitleSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
              )}
            </div>

            <div className="border-t border-[#E2E8F0] dark:border-[#334155] pt-5">
              <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                Welcome Message
              </label>
              <textarea
                rows={3}
                value={loginMessageDraft}
                onChange={e => { setLoginMessageDraft(e.target.value); setLoginMessageSaved(false) }}
                className={INPUT + ' resize-none'}
                placeholder="Enter the message shown on the login page…"
              />
            </div>

            {loginMessageError && (
              <p className="text-sm text-red-500">{loginMessageError}</p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={loginMessageSaving || loginMessageDraft.trim() === loginMessage}
                onClick={async () => {
                  const val = loginMessageDraft.trim()
                  if (!val) return
                  setLoginMessageSaving(true)
                  setLoginMessageError(null)
                  try {
                    await updateSetting('login_message', val)
                    setLoginMessage(val)
                    setLoginMessageSaved(true)
                  } catch (err) {
                    setLoginMessageError((err as Error).message)
                  } finally {
                    setLoginMessageSaving(false)
                  }
                }}
                className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                <MessageSquare size={14} />
                {loginMessageSaving ? 'Saving…' : 'Save Message'}
              </button>
              {loginMessageSaved && (
                <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>
              )}
            </div>

          </div>
        )}
      </section>
      )
      case 'navigation': return (
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setNavigationExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F0FDF4] text-[#16A34A] dark:bg-green-900/30 dark:text-green-300">
              <LayoutList size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Navigation</h2>
              <p className="text-sm text-[#64748B] mt-1">Control which links appear in the sidebar navigation.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {navigationExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {navigationExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-4">
            <label className="flex items-center justify-between gap-4 rounded-lg border border-[#E2E8F0] dark:border-[#334155] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9]">Show AI Summary link</p>
                <p className="text-xs text-[#64748B] mt-1">When enabled, the AI Summary page appears in the sidebar for administrators.</p>
              </div>
              <input
                type="checkbox"
                checked={aiSummaryEnabled}
                onChange={e => { void handleAiSummaryToggle(e.target.checked) }}
                disabled={aiSummarySaving}
                className="h-4 w-4 accent-[#2563EB]"
              />
            </label>
            {aiSummaryError && (
              <p className="text-sm text-red-500">{aiSummaryError}</p>
            )}
            {(aiSummarySaving || aiSummarySaved) && (
              <div className="flex items-center gap-3">
                {aiSummarySaving && <span className="text-sm text-[#64748B]">Saving…</span>}
                {aiSummarySaved && <span className="text-sm text-green-600 dark:text-green-400">Saved!</span>}
              </div>
            )}
          </div>
        )}
      </section>
      )
      case 'organizations': return user?.role !== 'super_admin' ? null : (
      <>
      <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setOrganizationsExpanded(expanded => !expanded)}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ECFDF5] text-[#15803D] dark:bg-green-900/30 dark:text-green-300">
              <Building2 size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Organizations</h2>
              <p className="text-sm text-[#64748B] mt-1">Create, update, and remove organizations used to scope users and collections.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs font-medium text-[#64748B]">{organizations.length} total</span>
            {organizationsExpanded ? (
              <ChevronDown size={18} className="text-[#64748B]" />
            ) : (
              <ChevronRight size={18} className="text-[#64748B]" />
            )}
          </div>
        </button>

        {organizationsExpanded && (
          <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-6">
            {user?.role === 'super_admin' && (
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={newOrganizationName}
                    onChange={e => setNewOrganizationName(e.target.value)}
                    placeholder="TSD"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Description</label>
                  <input
                    type="text"
                    value={newOrganizationDescription}
                    onChange={e => setNewOrganizationDescription(e.target.value)}
                    placeholder="Optional description"
                    className={INPUT}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateOrganization()}
                  disabled={organizationCreateSaving || !newOrganizationName.trim()}
                  className="inline-flex items-center justify-center gap-1.5 bg-[#15803D] hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                >
                  <Plus size={14} />
                  {organizationCreateSaving ? 'Creating…' : 'Add Organization'}
                </button>
              </div>
            )}

            {organizationCreateError && <p className="text-sm text-red-500">{organizationCreateError}</p>}
            {organizationSaveError && <p className="text-sm text-red-500">{organizationSaveError}</p>}
            {organizationDeleteError && <p className="text-sm text-red-500">{organizationDeleteError}</p>}

            <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] overflow-hidden">
              <table className="hidden md:table w-full text-sm">
                <thead>
                  <tr className="bg-[#F8FAFC] dark:bg-[#0F172A] text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Name</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Description</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Users</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Collections</th>
                    <th className="px-4 py-2.5 w-[170px]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#334155]">
                  {organizations.map(org => {
                    const isEditing = editingOrganizationId === org.id
                    return (
                      <tr key={org.id}>
                        <td className="px-4 py-2.5 text-[#1E293B] dark:text-[#F1F5F9] min-w-[180px]">
                          {isEditing ? (
                            <input type="text" value={editingOrganizationName} onChange={e => setEditingOrganizationName(e.target.value)} className={INPUT} />
                          ) : org.name}
                        </td>
                        <td className="px-4 py-2.5 text-[#64748B] min-w-[220px]">
                          {isEditing ? (
                            <input type="text" value={editingOrganizationDescription} onChange={e => setEditingOrganizationDescription(e.target.value)} className={INPUT} placeholder="Optional description" />
                          ) : (org.description ?? '—')}
                        </td>
                        <td className="px-4 py-2.5 text-[#64748B]">{org.userCount ?? 0}</td>
                        <td className="px-4 py-2.5 text-[#64748B]">{org.collectionCount ?? 0}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-2">
                            {isEditing ? (
                              <>
                                <button type="button" onClick={() => void handleSaveOrganization(org.id)} disabled={organizationEditSaving || !editingOrganizationName.trim()} className="inline-flex items-center gap-1 border border-[#16A34A] text-[#16A34A] hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 text-xs font-medium px-2 py-1 rounded transition-colors">
                                  <Save size={12} />
                                  Save
                                </button>
                                <button type="button" onClick={cancelOrganizationEdit} disabled={organizationEditSaving} className="inline-flex items-center gap-1 border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] text-xs font-medium px-2 py-1 rounded hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors">
                                  <X size={12} />
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button type="button" onClick={() => startOrganizationEdit(org)} className="text-[#94A3B8] hover:text-[#2563EB] transition-colors" title={`Edit ${org.name}`}>
                                <Pencil size={14} />
                              </button>
                            )}
                            {!isEditing && (
                              <button type="button" onClick={() => startOrganizationDelete(org)} className="text-[#94A3B8] hover:text-red-500 transition-colors" title={`Delete ${org.name}`}>
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {organizations.length === 0 && !organizationsLoading && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-[#94A3B8] italic">No organizations found.</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="md:hidden divide-y divide-[#E2E8F0] dark:divide-[#334155]">
                {organizations.map(org => {
                  const isEditing = editingOrganizationId === org.id
                  return (
                    <div key={org.id} className="p-4 space-y-3">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input type="text" value={editingOrganizationName} onChange={e => setEditingOrganizationName(e.target.value)} className={INPUT} placeholder="Organization name" />
                          <input type="text" value={editingOrganizationDescription} onChange={e => setEditingOrganizationDescription(e.target.value)} className={INPUT} placeholder="Optional description" />
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{org.name}</p>
                          <p className="text-sm text-[#64748B] mt-1">{org.description ?? 'No description'}</p>
                          <p className="text-xs text-[#94A3B8] mt-2">Users: {org.userCount ?? 0} • Collections: {org.collectionCount ?? 0}</p>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <button type="button" onClick={() => void handleSaveOrganization(org.id)} disabled={organizationEditSaving || !editingOrganizationName.trim()} className="inline-flex items-center gap-1 border border-[#16A34A] text-[#16A34A] hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 text-xs font-medium px-2.5 py-1.5 rounded transition-colors">
                              <Save size={12} />
                              Save
                            </button>
                            <button type="button" onClick={cancelOrganizationEdit} disabled={organizationEditSaving} className="inline-flex items-center gap-1 border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] text-xs font-medium px-2.5 py-1.5 rounded hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors">
                              <X size={12} />
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => startOrganizationEdit(org)} className="inline-flex items-center gap-1 border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] text-xs font-medium px-2.5 py-1.5 rounded hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors">
                            <Pencil size={12} />
                            Edit
                          </button>
                        )}
                        {!isEditing && (
                          <button type="button" onClick={() => startOrganizationDelete(org)} className="inline-flex items-center gap-1 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium px-2.5 py-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                            <Trash2 size={12} />
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </section>
      {organizationDeleteTarget && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close organization deletion panel"
            onClick={cancelOrganizationDelete}
            className="absolute inset-0 bg-slate-950/35"
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-white dark:bg-[#0F172A] border-l border-[#E2E8F0] dark:border-[#334155] shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-[#E2E8F0] dark:border-[#334155] flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-red-500">Danger Zone</div>
                <h2 className="mt-2 text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Delete {organizationDeleteTarget.name}</h2>
                <p className="mt-1 text-sm text-[#64748B] dark:text-[#94A3B8]">
                  This removes the organization and automatically deletes categories assigned to it.
                </p>
              </div>
              <button
                type="button"
                onClick={cancelOrganizationDelete}
                className="w-9 h-9 rounded-md flex items-center justify-center text-[#64748B] hover:text-[#1E293B] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {organizationDeleteError && (
                <div className="rounded border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                  {organizationDeleteError}
                </div>
              )}

              <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#111827] p-4 space-y-2 text-sm text-[#475569] dark:text-[#CBD5E1]">
                <p><strong>Organization:</strong> {organizationDeleteTarget.description?.trim() ? `${organizationDeleteTarget.description} (${organizationDeleteTarget.name})` : organizationDeleteTarget.name}</p>
                <p><strong>Users assigned:</strong> {organizationDeleteTarget.userCount ?? 0}</p>
                <p><strong>Collections assigned:</strong> {organizationDeleteTarget.collectionCount ?? 0}</p>
                <p><strong>Categories assigned:</strong> These will be deleted automatically with the organization.</p>
              </div>

              {(organizationDeleteTarget.userCount ?? 0) > 0 || (organizationDeleteTarget.collectionCount ?? 0) > 0 ? (
                <div className="rounded border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                  Remove or reassign all users and collections before deleting this organization.
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-[#475569] dark:text-[#CBD5E1]">
                    Are you sure? If so, type <span className="font-semibold">DELETE</span> below.
                  </p>
                  <input
                    type="text"
                    value={organizationDeleteConfirmation}
                    onChange={e => setOrganizationDeleteConfirmation(e.target.value)}
                    placeholder="DELETE"
                    className={INPUT}
                  />
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-[#E2E8F0] dark:border-[#334155] flex items-center justify-between gap-3">
              <div className="text-xs text-[#94A3B8]">This action cannot be undone.</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelOrganizationDelete}
                  disabled={organizationDeleteSaving}
                  className="inline-flex items-center gap-1.5 border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] text-sm font-medium px-3 py-2 rounded hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors disabled:opacity-50"
                >
                  <X size={14} />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteOrganization(organizationDeleteTarget.id)}
                  disabled={organizationDeleteSaving || (organizationDeleteTarget.userCount ?? 0) > 0 || (organizationDeleteTarget.collectionCount ?? 0) > 0 || organizationDeleteConfirmation.trim() !== 'DELETE'}
                  className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                >
                  <Trash2 size={14} />
                  {organizationDeleteSaving ? 'Deleting…' : 'Delete Organization'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
      </>
      )
      case 'locations': return (user?.role !== 'super_admin' && user?.role !== 'administrator') ? null : (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => {
              const next = !locationsExpanded
              setLocationsExpanded(next)
              if (next && locationsList.length === 0) void loadLocations()
            }}
            className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                <MapPin size={18} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Locations</h2>
                <p className="text-sm text-[#64748B] mt-1">Create and manage locations used to scope reviewer access to collection responses.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-medium text-[#64748B]">{locationsList.length} total</span>
              {locationsExpanded ? (
                <ChevronDown size={18} className="text-[#64748B]" />
              ) : (
                <ChevronRight size={18} className="text-[#64748B]" />
              )}
            </div>
          </button>

          {locationsExpanded && (
            <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-6">
              {/* Add location form */}
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={newLocationName}
                    onChange={e => { setNewLocationName(e.target.value); setLocationCreateError(null) }}
                    placeholder="e.g. North Campus"
                    className={INPUT}
                    onKeyDown={e => { if (e.key === 'Enter') void handleCreateLocation() }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateLocation()}
                  disabled={locationCreateSaving || !newLocationName.trim()}
                  className="inline-flex items-center justify-center gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                >
                  <Plus size={14} />
                  {locationCreateSaving ? 'Adding…' : 'Add Location'}
                </button>
              </div>

              {locationCreateError && <p className="text-sm text-red-500">{locationCreateError}</p>}
              {locationSaveError && <p className="text-sm text-red-500">{locationSaveError}</p>}
              {locationDeleteError && <p className="text-sm text-red-500">{locationDeleteError}</p>}

              <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] overflow-hidden">
                <table className="hidden md:table w-full text-sm">
                  <thead>
                    <tr className="bg-[#F8FAFC] dark:bg-[#0F172A] text-left">
                      <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Name</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Created</th>
                      <th className="px-4 py-2.5 w-[170px]"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#334155]">
                    {locationsList.map(loc => {
                      const isEditing = editingLocationId === loc.id
                      return (
                        <tr key={loc.id}>
                          <td className="px-4 py-2.5 text-[#1E293B] dark:text-[#F1F5F9] min-w-[200px]">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editingLocationName}
                                onChange={e => setEditingLocationName(e.target.value)}
                                className={INPUT}
                                onKeyDown={e => { if (e.key === 'Enter') void handleSaveLocation(loc.id) }}
                                autoFocus
                              />
                            ) : loc.name}
                          </td>
                          <td className="px-4 py-2.5 text-[#64748B] text-xs">
                            {new Date(loc.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-flex items-center gap-2">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void handleSaveLocation(loc.id)}
                                    disabled={locationEditSaving || !editingLocationName.trim()}
                                    className="inline-flex items-center gap-1 border border-[#16A34A] text-[#16A34A] hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 text-xs font-medium px-2 py-1 rounded transition-colors"
                                  >
                                    <Save size={12} />
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelLocationEdit}
                                    disabled={locationEditSaving}
                                    className="inline-flex items-center gap-1 border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] text-xs font-medium px-2 py-1 rounded hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
                                  >
                                    <X size={12} />
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startLocationEdit(loc)}
                                  className="text-[#94A3B8] hover:text-[#2563EB] transition-colors"
                                  title={`Rename ${loc.name}`}
                                >
                                  <Pencil size={14} />
                                </button>
                              )}
                              {!isEditing && (
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteLocation(loc.id)}
                                  className="text-[#94A3B8] hover:text-red-500 transition-colors"
                                  title={`Delete ${loc.name}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {locationsList.length === 0 && !locationsLoading && (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-sm text-[#94A3B8] italic">No locations yet. Add one above.</td>
                      </tr>
                    )}
                    {locationsLoading && (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-sm text-[#94A3B8] italic">Loading…</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Mobile list */}
                <div className="md:hidden divide-y divide-[#E2E8F0] dark:divide-[#334155]">
                  {locationsList.map(loc => {
                    const isEditing = editingLocationId === loc.id
                    return (
                      <div key={loc.id} className="p-4 space-y-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingLocationName}
                            onChange={e => setEditingLocationName(e.target.value)}
                            className={INPUT}
                            autoFocus
                          />
                        ) : (
                          <div>
                            <p className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{loc.name}</p>
                            <p className="text-xs text-[#94A3B8] mt-1">Created {new Date(loc.createdAt).toLocaleDateString()}</p>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleSaveLocation(loc.id)}
                                disabled={locationEditSaving || !editingLocationName.trim()}
                                className="inline-flex items-center gap-1 border border-[#16A34A] text-[#16A34A] hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 text-xs font-medium px-2.5 py-1.5 rounded transition-colors"
                              >
                                <Save size={12} />
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelLocationEdit}
                                disabled={locationEditSaving}
                                className="inline-flex items-center gap-1 border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] text-xs font-medium px-2.5 py-1.5 rounded hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
                              >
                                <X size={12} />
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startLocationEdit(loc)}
                              className="inline-flex items-center gap-1 border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] text-xs font-medium px-2.5 py-1.5 rounded hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
                            >
                              <Pencil size={12} />
                              Rename
                            </button>
                          )}
                          {!isEditing && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteLocation(loc.id)}
                              className="inline-flex items-center gap-1 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium px-2.5 py-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            >
                              <Trash2 size={12} />
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {locationsList.length === 0 && !locationsLoading && (
                    <p className="p-4 text-sm text-[#94A3B8] italic text-center">No locations yet. Add one above.</p>
                  )}
                  {locationsLoading && (
                    <p className="p-4 text-sm text-[#94A3B8] italic text-center">Loading…</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )
      case 'gallery': return (user?.role !== 'super_admin' && user?.role !== 'administrator') ? null : (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => {
              const next = !galleryExpanded
              setGalleryExpanded(next)
              if (next && galleryAssets.length === 0) void loadGallery()
            }}
            className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <ImageIcon size={18} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Cover Photo Gallery</h2>
                <p className="text-sm text-[#64748B] mt-1">Upload organization-specific cover images here before assigning them to collections.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs font-medium text-[#64748B]">{galleryAssets.length} total</span>
              {galleryExpanded ? (
                <ChevronDown size={18} className="text-[#64748B]" />
              ) : (
                <ChevronRight size={18} className="text-[#64748B]" />
              )}
            </div>
          </button>

          {galleryExpanded && (
            <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-6">
              <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] p-4 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Upload to {user?.activeOrganizationDescription ?? user?.activeOrganizationName ?? 'current organization'} gallery</h3>
                  <p className="mt-1 text-xs text-[#64748B]">Collections can only choose cover images that already exist in this gallery.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input
                    type="text"
                    value={galleryUploadName}
                    onChange={e => setGalleryUploadName(e.target.value)}
                    placeholder="Image name"
                    className={INPUT}
                  />
                  <input
                    type="text"
                    value={galleryUploadAltText}
                    onChange={e => setGalleryUploadAltText(e.target.value)}
                    placeholder="Alt text (optional)"
                    className={INPUT}
                  />
                </div>
                <input
                  type="text"
                  value={galleryUploadTags}
                  onChange={e => setGalleryUploadTags(e.target.value)}
                  placeholder="Tags, comma separated"
                  className={INPUT}
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => setGalleryUploadFile(e.target.files?.[0] ?? null)}
                    className="block text-sm text-[#475569] dark:text-[#CBD5E1]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleGalleryUpload()}
                    disabled={galleryUploadSaving || !galleryUploadFile}
                    className="inline-flex items-center justify-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                  >
                    <Plus size={14} />
                    {galleryUploadSaving ? 'Uploading…' : 'Upload to Gallery'}
                  </button>
                </div>
              </div>

              {galleryError && <p className="text-sm text-red-500">{galleryError}</p>}

              {galleryLoading ? (
                <p className="text-sm text-[#64748B]">Loading gallery…</p>
              ) : galleryAssets.length === 0 ? (
                <p className="text-sm text-[#64748B]">No gallery images uploaded yet.</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {galleryAssets.map(asset => (
                    <article key={asset.id} className="overflow-hidden rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-white dark:bg-[#0F172A]">
                      <div className="h-40 bg-[#F8FAFC] dark:bg-[#0F172A]">
                        <img src={asset.fileUrl} alt={asset.altText ?? asset.name} className="h-full w-full object-cover" />
                      </div>
                      <div className="space-y-2 p-4">
                        <div>
                          <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{asset.name}</h3>
                          <p className="mt-1 text-xs text-[#64748B]">Used by {asset.usageCount} collection{asset.usageCount === 1 ? '' : 's'}</p>
                        </div>
                        {asset.tags.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {asset.tags.map(tag => (
                              <span key={`${asset.id}-${tag}`} className="rounded-full bg-[#E2E8F0] dark:bg-[#1E293B] px-2 py-1 text-[11px] text-[#475569] dark:text-[#CBD5E1]">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-[#94A3B8]">{new Date(asset.createdAt).toLocaleDateString()}</span>
                          <button
                            type="button"
                            onClick={() => void handleGalleryDelete(asset.id)}
                            disabled={asset.usageCount > 0 || galleryDeleteSavingId === asset.id}
                            className="inline-flex items-center gap-1.5 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium px-3 py-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                            {galleryDeleteSavingId === asset.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )
      case 'users': return (
        <>
        <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => {
              const next = !usersExpanded
              setUsersExpanded(next)
              if (next && allUsers.length === 0) loadUsers()
            }}
            className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] dark:bg-blue-900/30 dark:text-blue-300">
                <Users size={18} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">User Accounts</h2>
                <p className="text-sm text-[#64748B] mt-1">Create and manage accounts for testing or onboarding users.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {usersExpanded ? (
                <ChevronDown size={18} className="text-[#64748B]" />
              ) : (
                <ChevronRight size={18} className="text-[#64748B]" />
              )}
            </div>
          </button>

          {usersExpanded && (
            <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-6">

              {/* ── Invite User ─────────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Mail size={15} className="text-[#2563EB]" />
                  <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Invite User by Email</h3>
                </div>
                <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                  Send an invite link to a new user. They will receive an email with a link to set their password and activate their account.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={inviteName}
                      onChange={e => { setInviteName(e.target.value); setInviteSuccess(null); setInviteLink(null) }}
                      placeholder="Jane Smith"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Email <span className="text-red-500">*</span></label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => { setInviteEmail(e.target.value); setInviteSuccess(null); setInviteLink(null) }}
                      placeholder="jane@example.com"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Role</label>
                    <select
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as typeof inviteRole)}
                      className={INPUT}
                    >
                      <option value="user">User</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="team_manager">Team Manager</option>
                      <option value="administrator">Administrator</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void handleSendInvite()}
                    disabled={inviteSaving || !inviteName.trim() || !inviteEmail.trim()}
                    className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                  >
                    <Mail size={14} />
                    {inviteSaving ? 'Sending…' : 'Send Invite'}
                  </button>
                  {inviteError && <span className="text-sm text-red-500">{inviteError}</span>}
                  {inviteSuccess && (
                    <span className="text-sm text-green-600 dark:text-green-400">{inviteSuccess}</span>
                  )}
                </div>
                {/* Show invite link for local/dev environments where email may not be configured */}
                {inviteLink && (
                  <div className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 space-y-1">
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-300">Invite link (email not configured — share this directly):</p>
                    <a
                      href={inviteLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 underline break-all"
                    >
                      {inviteLink}
                    </a>
                  </div>
                )}
              </div>

              <div className="border-t border-[#E2E8F0] dark:border-[#334155]" />

              {/* Create user form */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Add New User</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={newUserName}
                      onChange={e => { setNewUserName(e.target.value); setUserCreateSuccess(null) }}
                      placeholder="Jane Smith"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Email <span className="text-red-500">*</span></label>
                    <input
                      type="email"
                      value={newUserEmail}
                      onChange={e => { setNewUserEmail(e.target.value); setUserCreateSuccess(null) }}
                      placeholder="jane@example.com"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Access</label>
                    <select
                      value={newUserRole}
                      onChange={e => setNewUserRole(e.target.value as typeof newUserRole)}
                      className={INPUT}
                    >
                      <option value="user">Organization Member</option>
                      {user?.role === 'super_admin' && (
                        <option value="super_admin">Super Admin</option>
                      )}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">
                      Memberships{newUserRole !== 'super_admin' && <span className="text-red-500"> *</span>}
                    </label>
                    {newUserRole === 'super_admin' ? (
                      <p className="text-sm text-[#64748B] dark:text-[#94A3B8]">Super admins have global access and do not need organization memberships.</p>
                    ) : renderMembershipEditor(newUserMemberships, setNewUserMemberships, userCreateSaving)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCreateUser()}
                    disabled={userCreateSaving || !newUserName.trim() || !newUserEmail.trim()}
                    className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                  >
                    <Users size={14} />
                    {userCreateSaving ? 'Creating…' : 'Create User'}
                  </button>
                  {userCreateError && <span className="text-sm text-red-500">{userCreateError}</span>}
                  {userCreateSuccess && (
                    <span className="text-sm text-green-600 dark:text-green-400">
                      Created! Log in with User ID <strong>{userCreateSuccess}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* User list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">All Users</h3>
                  <button
                    type="button"
                    onClick={loadUsers}
                    disabled={usersLoading}
                    className="text-xs text-[#64748B] hover:text-[#2563EB] transition-colors disabled:opacity-40"
                  >
                    {usersLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>

                {userDeleteError && (
                  <p className="text-sm text-red-500">{userDeleteError}</p>
                )}

                {userEditError && (
                  <p className="text-sm text-red-500">{userEditError}</p>
                )}

                <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] overflow-hidden">
                  <table className="hidden md:table w-full text-sm">
                    <thead>
                      <tr className="bg-[#F8FAFC] dark:bg-[#0F172A] text-left">
                        <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide w-12">ID</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Name</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Email</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide">Access</th>
                        <th className="px-4 py-2.5 w-[170px]"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#334155]">
                      {allUsers.map(u => {
                        const isEditing = editingUserId === u.id
                        return (
                          <tr key={u.id} className={`${u.id === user?.id ? 'bg-blue-50 dark:bg-blue-900/10' : ''} ${isEditing ? 'bg-slate-50 dark:bg-slate-800/50' : ''}`}>
                            <td className="px-4 py-2.5 text-[#94A3B8] font-mono text-xs">{u.id}</td>
                            <td className="px-4 py-2.5 text-[#1E293B] dark:text-[#F1F5F9] min-w-[180px]">
                              {u.name}
                              {u.id === user?.id && (
                                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">(you)</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-[#64748B] min-w-[220px]">
                              {u.email}
                            </td>
                            <td className="px-4 py-2.5 min-w-[170px]">
                              <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-[2px] ${getUserAccessSummary(u).className}`}>
                                {getUserAccessSummary(u).label}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => startUserEdit(u)}
                                  className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${isEditing ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB] dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300' : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]'}`}
                                  title={`Edit ${u.name}`}
                                >
                                  <Pencil size={12} />
                                  {isEditing ? 'Editing' : 'Edit'}
                                </button>
                                {u.id !== user?.id && !isEditing && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteUser(u.id)}
                                    className="text-[#94A3B8] hover:text-red-500 transition-colors"
                                    title={`Delete ${u.name}`}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                      {allUsers.length === 0 && !usersLoading && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sm text-[#94A3B8] italic">No users found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  <div className="md:hidden divide-y divide-[#E2E8F0] dark:divide-[#334155]">
                    {allUsers.map(u => {
                      const isEditing = editingUserId === u.id
                      return (
                        <div key={u.id} className={`p-4 space-y-3 ${u.id === user?.id ? 'bg-blue-50 dark:bg-blue-900/10' : ''}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs text-[#94A3B8] font-mono">ID: {u.id}</p>
                              <p className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] mt-0.5">
                                {u.name}
                                {u.id === user?.id && (
                                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">(you)</span>
                                )}
                              </p>
                            </div>
                            {!isEditing && (
                              <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-[2px] ${getUserAccessSummary(u).className}`}>
                                {getUserAccessSummary(u).label}
                              </span>
                            )}
                          </div>

                          <div className="space-y-2 text-sm text-[#64748B]">
                            <p>{u.email}</p>
                            <div className="space-y-1">
                              {summarizeUserMemberships(u).map(summary => (
                                <p key={summary}>{summary}</p>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => startUserEdit(u)}
                              className={`inline-flex items-center gap-1 border text-xs font-medium px-2.5 py-1.5 rounded transition-colors ${isEditing ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB] dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300' : 'border-[#CBD5E1] dark:border-[#334155] text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A]'}`}
                            >
                              <Pencil size={12} />
                              {isEditing ? 'Editing' : 'Edit'}
                            </button>

                            {u.id !== user?.id && !isEditing && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteUser(u.id)}
                                className="inline-flex items-center gap-1 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium px-2.5 py-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              >
                                <Trash2 size={12} />
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {allUsers.length === 0 && !usersLoading && (
                      <div className="px-4 py-6 text-center text-sm text-[#94A3B8] italic">No users found.</div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-[#94A3B8]">To log in as a user, use the ID shown above on the login screen.</p>
              </div>

            </div>
          )}
        </section>
        {editingUser && (
          <div className="fixed inset-0 z-50">
            <button
              type="button"
              aria-label="Close user editor"
              onClick={cancelUserEdit}
              className="absolute inset-0 bg-slate-950/35"
            />
            <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white dark:bg-[#0F172A] border-l border-[#E2E8F0] dark:border-[#334155] shadow-2xl flex flex-col">
              <div className="px-5 py-4 border-b border-[#E2E8F0] dark:border-[#334155] flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[#94A3B8]">
                    <Users size={13} />
                    User Editor
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">{editingUserName || editingUser.name}</h2>
                  <p className="mt-1 text-sm text-[#64748B] dark:text-[#94A3B8]">User ID {editingUser.id}</p>
                </div>
                <button
                  type="button"
                  onClick={cancelUserEdit}
                  className="w-9 h-9 rounded-md flex items-center justify-center text-[#64748B] hover:text-[#1E293B] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
                {userEditError && (
                  <div className="rounded border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                    {userEditError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={editingUserName}
                      onChange={e => setEditingUserName(e.target.value)}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Email <span className="text-red-500">*</span></label>
                    <input
                      type="email"
                      value={editingUserEmail}
                      onChange={e => setEditingUserEmail(e.target.value)}
                      className={INPUT}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Access</label>
                    <select
                      value={editingUserRole}
                      onChange={e => setEditingUserRole(e.target.value as typeof editingUserRole)}
                      className={INPUT}
                    >
                      <option value="user">Organization Member</option>
                      {user?.role === 'super_admin' && (
                        <option value="super_admin">Super Admin</option>
                      )}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#475569] dark:text-[#94A3B8] mb-1">Memberships</label>
                  {editingUserRole === 'super_admin' ? (
                    <p className="text-sm text-[#64748B] dark:text-[#94A3B8]">Global access only.</p>
                  ) : (
                    renderMembershipEditor(editingUserMemberships, setEditingUserMemberships, userEditSaving)
                  )}
                </div>

                {editingUserMemberships.some(membership => membership.role === 'reviewer') && (
                  <div className="rounded-lg border border-teal-100 dark:border-teal-900/30 bg-teal-50 dark:bg-teal-900/10 p-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Assigned Locations</h3>
                      <p className="mt-1 text-xs text-[#64748B] dark:text-[#94A3B8]">Reviewer memberships can be limited to specific locations.</p>
                    </div>
                    {editingUserLocationsLoading ? (
                      <p className="text-xs text-[#94A3B8] italic">Loading…</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {editingUserLocations.map(loc => (
                          <span key={loc.id} className="inline-flex items-center gap-1 bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 text-xs px-2 py-0.5 rounded">
                            {loc.name}
                            <button
                              type="button"
                              onClick={() => setEditingUserLocations(prev => prev.filter(l => l.id !== loc.id))}
                              className="hover:text-teal-900 dark:hover:text-teal-100"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                        {editingUserLocations.length === 0 && (
                          <span className="text-xs text-[#94A3B8] italic">No locations assigned</span>
                        )}
                      </div>
                    )}
                    <div className="max-w-md">
                      <LocationTypeahead
                        value={null}
                        onChange={loc => {
                          if (loc && !editingUserLocations.find(existingLocation => existingLocation.id === loc.id)) {
                            setEditingUserLocations(prev => [...prev, loc])
                          }
                        }}
                        placeholder="Add location…"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-t border-[#E2E8F0] dark:border-[#334155] flex items-center justify-between gap-3">
                <div className="text-xs text-[#94A3B8]">Changes are saved for this user only.</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={cancelUserEdit}
                    disabled={userEditSaving}
                    className="inline-flex items-center gap-1.5 border border-[#CBD5E1] dark:border-[#334155] text-[#64748B] text-sm font-medium px-3 py-2 rounded hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors disabled:opacity-50"
                  >
                    <X size={14} />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveUser(editingUser.id)}
                    disabled={userEditSaving || !editingUserName.trim() || !editingUserEmail.trim()}
                    className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                  >
                    <Save size={14} />
                    {userEditSaving ? 'Saving…' : 'Save User'}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        )}
        </>
      )
      case 'seed': return (
        <section className="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => {
              const next = !seedExpanded
              setSeedExpanded(next)
              setSeedError(null)
              setSeedSuccess(null)
              if (next && seedCollections.length === 0) loadSeedCollections()
            }}
            className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-[#0F172A] transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB] dark:bg-blue-900/30 dark:text-blue-300">
                <Database size={18} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Seed Data</h2>
                <p className="text-sm text-[#64748B] mt-1">Create up to 20 demo submissions at a time with randomized submission dates from the last 30 days.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {seedExpanded ? (
                <ChevronDown size={18} className="text-[#64748B]" />
              ) : (
                <ChevronRight size={18} className="text-[#64748B]" />
              )}
            </div>
          </button>

          {seedExpanded && (
            <div className="border-t border-[#E2E8F0] dark:border-[#334155] p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                    Collection
                  </label>
                  <select
                    value={seedCollectionId}
                    onChange={e => {
                      setSeedCollectionId(e.target.value)
                      setSeedError(null)
                      setSeedSuccess(null)
                    }}
                    disabled={seedCollectionsLoading || seedSaving || seedCollections.length === 0}
                    className={INPUT}
                  >
                    <option value="">Select a collection</option>
                    {seedCollections.map(collection => (
                      <option key={collection.id} value={collection.id}>
                        {collection.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#475569] dark:text-[#94A3B8] uppercase tracking-wide mb-2">
                    Seed Count
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={seedCount}
                    onChange={e => {
                      setSeedCount(e.target.value)
                      setSeedError(null)
                      setSeedSuccess(null)
                    }}
                    disabled={seedSaving}
                    className={INPUT}
                  />
                  <p className="text-xs text-[#64748B] mt-1">Each run is capped at 20 submissions.</p>
                </div>
              </div>

              <div className="rounded-lg border border-[#E2E8F0] dark:border-[#334155] bg-[#F8FAFC] dark:bg-[#0F172A] p-4 text-sm text-[#475569] dark:text-[#CBD5E1] space-y-1">
                <p>
                  {selectedSeedCollection
                    ? `Selected: ${selectedSeedCollection.title}`
                    : 'Choose a collection to seed.'}
                </p>
                {selectedSeedCollection && (
                  <p>
                    Current responses: {selectedSeedCollection.responseCount ?? 0}
                    {selectedSeedCollection.category ? ` • Category: ${selectedSeedCollection.category}` : ''}
                  </p>
                )}
              </div>

              {seedError && <p className="text-sm text-red-500">{seedError}</p>}
              {seedSuccess && <p className="text-sm text-green-600 dark:text-green-400">{seedSuccess}</p>}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleSeedCollection()}
                  disabled={
                    seedSaving ||
                    seedCollectionsLoading ||
                    !seedCollectionId ||
                    seedCollections.length === 0
                  }
                  className="inline-flex items-center gap-1.5 bg-[#2563EB] hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                >
                  <Database size={14} />
                  {seedSaving ? 'Seeding…' : 'Seed Collection'}
                </button>
                <button
                  type="button"
                  onClick={loadSeedCollections}
                  disabled={seedCollectionsLoading || seedSaving}
                  className="inline-flex items-center gap-1.5 border border-[#CBD5E1] dark:border-[#334155] text-[#475569] dark:text-[#CBD5E1] text-sm font-medium px-4 py-2 rounded hover:bg-[#F1F5F9] dark:hover:bg-[#1E293B] transition-colors disabled:opacity-60"
                >
                  {seedCollectionsLoading ? 'Loading…' : 'Refresh Collections'}
                </button>
              </div>
            </div>
          )}
        </section>
      )
      default: return null
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={tabAwareCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="max-w-4xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[#1E293B] dark:text-[#F1F5F9]">Settings</h1>
          <p className="text-sm text-[#64748B] mt-0.5">Manage collection categories used throughout the application.</p>
        </div>

        {error && (
          <div className="mb-6 rounded border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex border-b border-[#E2E8F0] dark:border-[#334155] mb-6">
          <DroppableTabButton
            tab="general"
            label="General"
            isActive={activeTab === 'general'}
            isDragging={draggingId !== null}
            onClick={() => setActiveTab('general')}
          />
          <DroppableTabButton
            tab="other"
            label="Other"
            isActive={activeTab === 'other'}
            isDragging={draggingId !== null}
            onClick={() => setActiveTab('other')}
          />
        </div>

        <SortableContext items={panelLayout[activeTab]} strategy={verticalListSortingStrategy}>
          <div className="space-y-6">
            {panelLayout[activeTab].map(id => (
              <SettingsSortablePanel key={id} id={id}>
                {renderPanel(id)}
              </SettingsSortablePanel>
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {draggingId && (
            <div className="bg-white dark:bg-[#1E293B] border border-[#2563EB] rounded-lg px-5 py-4 shadow-lg text-sm font-medium text-[#1E293B] dark:text-[#F1F5F9] opacity-90">
              {PANEL_LABELS[draggingId]}
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  )
}