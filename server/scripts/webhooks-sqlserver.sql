-- Webhooks feature schema for SQL Server (Azure SQL).
-- Apply once to the target database before deploying the webhooks code.
-- Safe to re-run: every statement is guarded.

IF OBJECT_ID('dbo.webhooks', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.webhooks (
    id              BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    organization_id BIGINT NOT NULL,
    [key]           NVARCHAR(32) NOT NULL,
    name            NVARCHAR(120) NULL,
    url             NVARCHAR(4000) NOT NULL,
    secret          NVARCHAR(512) NULL,
    enabled         BIT NOT NULL CONSTRAINT DF_webhooks_enabled DEFAULT (1),
    timeout_ms      INT NOT NULL CONSTRAINT DF_webhooks_timeout DEFAULT (5000),
    response_shape  NVARCHAR(20) NOT NULL CONSTRAINT DF_webhooks_shape DEFAULT ('json_boolean'),
    response_key    NVARCHAR(64) NOT NULL CONSTRAINT DF_webhooks_key DEFAULT ('valid'),
    created_by      BIGINT NULL,
    created_at      NVARCHAR(32) NOT NULL CONSTRAINT DF_webhooks_created DEFAULT (CONVERT(NVARCHAR(32), GETDATE(), 120)),
    updated_at      NVARCHAR(32) NOT NULL CONSTRAINT DF_webhooks_updated DEFAULT (CONVERT(NVARCHAR(32), GETDATE(), 120)),
    CONSTRAINT FK_webhooks_organization FOREIGN KEY (organization_id)
      REFERENCES dbo.organizations(id) ON DELETE CASCADE,
    CONSTRAINT FK_webhooks_created_by FOREIGN KEY (created_by)
      REFERENCES dbo.users(id) ON DELETE NO ACTION,
    CONSTRAINT CK_webhooks_key CHECK ([key] IN ('webhook-1', 'webhook-2')),
    CONSTRAINT CK_webhooks_shape CHECK (response_shape IN ('json_boolean', 'json_string', 'plain_text')),
    CONSTRAINT UQ_webhooks_org_key UNIQUE (organization_id, [key])
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_webhooks_org' AND object_id = OBJECT_ID('dbo.webhooks'))
  CREATE INDEX idx_webhooks_org ON dbo.webhooks(organization_id, [key]);
GO

IF OBJECT_ID('dbo.webhook_deliveries', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.webhook_deliveries (
    id            BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    webhook_id    BIGINT NOT NULL,
    response_id   BIGINT NULL,
    direction     NVARCHAR(16) NOT NULL,
    status        NVARCHAR(16) NOT NULL,
    http_status   INT NULL,
    duration_ms   INT NULL,
    error         NVARCHAR(1000) NULL,
    response_body NVARCHAR(1000) NULL,
    created_at    NVARCHAR(32) NOT NULL CONSTRAINT DF_webhook_deliveries_created DEFAULT (CONVERT(NVARCHAR(32), GETDATE(), 120)),
    CONSTRAINT FK_webhook_deliveries_webhook FOREIGN KEY (webhook_id)
      REFERENCES dbo.webhooks(id) ON DELETE CASCADE,
    CONSTRAINT FK_webhook_deliveries_response FOREIGN KEY (response_id)
      REFERENCES dbo.collection_responses(id) ON DELETE SET NULL,
    CONSTRAINT CK_webhook_deliveries_direction CHECK (direction IN ('validate', 'submit')),
    CONSTRAINT CK_webhook_deliveries_status CHECK (status IN ('success', 'failed'))
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_webhook_deliveries_hook' AND object_id = OBJECT_ID('dbo.webhook_deliveries'))
  CREATE INDEX idx_webhook_deliveries_hook ON dbo.webhook_deliveries(webhook_id, created_at);
GO

-- The field -> webhook binding lives here rather than on collection_fields so
-- that adding the Student ID field type needs no table rebuild.
IF OBJECT_ID('dbo.webhook_field_bindings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.webhook_field_bindings (
    webhook_id BIGINT NOT NULL,
    field_id   BIGINT NOT NULL,
    created_at NVARCHAR(32) NOT NULL CONSTRAINT DF_webhook_field_bindings_created DEFAULT (CONVERT(NVARCHAR(32), GETDATE(), 120)),
    CONSTRAINT PK_webhook_field_bindings PRIMARY KEY (webhook_id, field_id),
    CONSTRAINT FK_webhook_field_bindings_webhook FOREIGN KEY (webhook_id)
      REFERENCES dbo.webhooks(id) ON DELETE CASCADE,
    CONSTRAINT FK_webhook_field_bindings_field FOREIGN KEY (field_id)
      REFERENCES dbo.collection_fields(id) ON DELETE CASCADE
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_webhook_field_bindings_field' AND object_id = OBJECT_ID('dbo.webhook_field_bindings'))
  CREATE INDEX idx_webhook_field_bindings_field ON dbo.webhook_field_bindings(field_id);
GO
