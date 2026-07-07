import fs from 'fs'
import path from 'path'

const root = process.cwd()
const sourceDir = path.join(root, 'client', 'dist')
const targetDir = path.join(root, 'server', 'public')

if (!fs.existsSync(sourceDir)) {
  console.error(`Client build output not found at ${sourceDir}`)
  process.exit(1)
}

fs.rmSync(targetDir, { recursive: true, force: true })
fs.mkdirSync(targetDir, { recursive: true })
fs.cpSync(sourceDir, targetDir, { recursive: true })
console.log(`Copied client build from ${sourceDir} to ${targetDir}`)
