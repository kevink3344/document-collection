import { type Express } from 'express'
import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUi from 'swagger-ui-express'

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Data Collection Pro API',
      version: '1.0.0',
      description:
        'REST API for Data Collection Pro — enterprise data management platform.',
    },
    servers: [
      { url: 'http://localhost:4000', description: 'Development server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth',  description: 'Authentication endpoints' },
      { name: 'Users', description: 'User management' },
    ],
  },
  apis: ['./src/routes/*.ts'],
}

export function setupSwagger(app: Express): void {
  const spec = swaggerJsdoc(options)
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, {
    customCss: '.swagger-ui .topbar { display: none }',
  }))
  console.log('[swagger] Docs → http://localhost:4000/api-docs')
}
