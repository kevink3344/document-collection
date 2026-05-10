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