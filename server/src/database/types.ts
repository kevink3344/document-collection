import Database from 'libsql'
export type { DbAdapter } from './adapter'

export type AppDatabase = InstanceType<typeof Database>
