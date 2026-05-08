import { type Express } from 'express'
import path from 'path'
import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUi from 'swagger-ui-express'

const PORT = process.env.PORT ?? 4000
const SWAGGER_SERVER_URL =
  process.env.SWAGGER_SERVER_URL ??
  (process.env.WEBSITE_HOSTNAME
    ? `https://${process.env.WEBSITE_HOSTNAME}`
    : `http://localhost:${PORT}`)
const SWAGGER_APIS = [
  path.resolve(__dirname, '../routes/*.js'),
  path.resolve(__dirname, '../routes/*.ts'),
  path.resolve(process.cwd(), 'src/routes/*.ts'),
]

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Data Collection Pro API',
      version: '1.0.0',
      description:
        'REST API for Data Collection Pro — enterprise data management platform.',
    },
    servers: [{ url: SWAGGER_SERVER_URL, description: 'API server' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id:           { type: 'integer', example: 1 },
            name:         { type: 'string',  example: 'Jon Rivera' },
            email:        { type: 'string',  format: 'email', example: 'jon@datacollectionpro.com' },
            role:         { type: 'string',  enum: ['administrator', 'team_manager', 'user'] },
            organization: { type: 'string',  nullable: true },
            createdAt:    { type: 'string',  format: 'date-time' },
          },
        },
        Category: {
          type: 'object',
          properties: {
            id:        { type: 'integer', example: 1 },
            name:      { type: 'string',  example: 'Finance' },
            sortOrder: { type: 'integer', example: 0 },
          },
        },
        TableColumn: {
          type: 'object',
          properties: {
            id:          { type: 'integer', example: 1 },
            name:        { type: 'string',  example: 'Quantity' },
            colType:     { type: 'string',  enum: ['text', 'number', 'date', 'checkbox', 'list'], example: 'number' },
            listOptions: { type: 'array', items: { type: 'string' }, nullable: true },
            sortOrder:   { type: 'integer', example: 0 },
          },
        },
        TableColumnInput: {
          type: 'object',
          required: ['name', 'colType'],
          properties: {
            name:        { type: 'string',  example: 'Quantity' },
            colType:     { type: 'string',  enum: ['text', 'number', 'date', 'checkbox', 'list'], example: 'number' },
            listOptions: { type: 'array', items: { type: 'string' }, description: 'Required when colType is list' },
            sortOrder:   { type: 'integer', example: 0 },
          },
        },
        CollectionField: {
          type: 'object',
          properties: {
            id:           { type: 'integer', example: 1 },
            type:         { type: 'string',  enum: ['short_text', 'long_text', 'single_choice', 'multiple_choice', 'attachment', 'signature', 'confirmation', 'custom_table', 'rating'] },
            label:        { type: 'string',  example: 'Full Name' },
            page:         { type: 'integer', example: 1 },
            required:     { type: 'boolean', example: true },
            options:      { type: 'array', items: { type: 'string' }, nullable: true },
            sortOrder:    { type: 'integer', example: 0 },
            tableColumns: { type: 'array', items: { '$ref': '#/components/schemas/TableColumn' }, nullable: true },
          },
        },
        CollectionFieldInput: {
          type: 'object',
          required: ['type', 'label'],
          properties: {
            type:         { type: 'string',  enum: ['short_text', 'long_text', 'single_choice', 'multiple_choice', 'attachment', 'signature', 'confirmation', 'custom_table', 'rating'] },
            label:        { type: 'string',  example: 'Full Name' },
            page:         { type: 'integer', example: 1 },
            required:     { type: 'boolean', example: false },
            options:      { type: 'array', items: { type: 'string' } },
            sortOrder:    { type: 'integer', example: 0 },
            tableColumns: { type: 'array', items: { '$ref': '#/components/schemas/TableColumnInput' } },
          },
        },
        Collection: {
          type: 'object',
          properties: {
            id:                  { type: 'integer', example: 1 },
            slug:                { type: 'string',  example: 'quarterly-survey-abc123' },
            title:               { type: 'string',  example: 'Quarterly Survey' },
            status:              { type: 'string',  enum: ['draft', 'published'] },
            description:         { type: 'string',  nullable: true },
            category:            { type: 'string',  nullable: true, example: 'Finance' },
            createdBy:           { type: 'integer', example: 1 },
            createdByName:       { type: 'string',  nullable: true, example: 'Jon Rivera' },
            dateDue:             { type: 'string',  nullable: true, example: '2026-06-30' },
            coverPhotoUrl:       { type: 'string',  nullable: true },
            instructions:        { type: 'string',  nullable: true },
            instructionsDocUrl:  { type: 'string',  nullable: true },
            anonymous:           { type: 'boolean', example: false },
            createdAt:           { type: 'string',  format: 'date-time' },
            updatedAt:           { type: 'string',  format: 'date-time' },
            responseCount:       { type: 'integer', example: 12, description: 'Only included in list responses' },
            fields:              { type: 'array', items: { '$ref': '#/components/schemas/CollectionField' } },
          },
        },
        CollectionInput: {
          type: 'object',
          required: ['title'],
          properties: {
            title:               { type: 'string',  example: 'Quarterly Survey' },
            status:              { type: 'string',  enum: ['draft', 'published'], default: 'draft' },
            description:         { type: 'string' },
            category:            { type: 'string',  example: 'Finance' },
            dateDue:             { type: 'string',  example: '2026-06-30' },
            coverPhotoUrl:       { type: 'string' },
            instructions:        { type: 'string' },
            instructionsDocUrl:  { type: 'string' },
            anonymous:           { type: 'boolean', default: false },
            fields:              { type: 'array', items: { '$ref': '#/components/schemas/CollectionFieldInput' } },
          },
        },
        ResponseValue: {
          type: 'object',
          properties: {
            fieldId: { type: 'integer', example: 5 },
            value:   { type: 'string',  example: 'Yes' },
          },
        },
        CollectionResponse: {
          type: 'object',
          properties: {
            id:              { type: 'integer', example: 1 },
            respondentName:  { type: 'string',  nullable: true },
            respondentEmail: { type: 'string',  nullable: true },
            submittedAt:     { type: 'string',  format: 'date-time' },
            values:          { type: 'array', items: { '$ref': '#/components/schemas/ResponseValue' } },
          },
        },
        AppSetting: {
          type: 'object',
          properties: {
            key:   { type: 'string', example: 'login_message' },
            value: { type: 'string', example: 'Welcome to Data Collection Pro.' },
          },
        },
        Notification: {
          type: 'object',
          properties: {
            id:             { type: 'integer', example: 12 },
            userId:         { type: 'integer', example: 3 },
            collectionId:   { type: 'integer', example: 5 },
            collectionSlug: { type: 'string',  example: 'quarterly-survey-abc123' },
            type:           { type: 'string',  enum: ['due_soon', 'overdue'] },
            title:          { type: 'string',  example: 'Collection overdue' },
            message:        { type: 'string',  example: '"Quarterly Survey" was due on 2026-05-01.' },
            dueDate:        { type: 'string',  example: '2026-05-01' },
            isRead:         { type: 'boolean', example: false },
            createdAt:      { type: 'string',  format: 'date-time' },
            readAt:         { type: 'string',  format: 'date-time', nullable: true },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Not found' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth',        description: 'Authentication — login and register' },
      { name: 'Users',       description: 'User management' },
      { name: 'Collections', description: 'Collection CRUD and publishing' },
      { name: 'Public',      description: 'Public-facing endpoints (no auth required)' },
      { name: 'Responses',   description: 'Survey response submission and retrieval' },
      { name: 'Categories',  description: 'Category management (admin only for write operations)' },
      { name: 'Settings',    description: 'App-wide settings (login message, etc.)' },
      { name: 'Notifications', description: 'In-app due date and overdue notifications' },
    ],
  },
  apis: SWAGGER_APIS,
}

export function setupSwagger(app: Express): void {
  const spec = swaggerJsdoc(options)
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, {
    customCss: '.swagger-ui .topbar { display: none }',
  }))
  console.log(`[swagger] Docs → ${SWAGGER_SERVER_URL}/api-docs`)
}
