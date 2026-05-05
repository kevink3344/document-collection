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
