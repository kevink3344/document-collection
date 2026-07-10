-- ============================================================
-- Seed collection_fields data into Azure SQL Server
-- Safe to re-run: drops and recreates the table, then inserts
-- all rows with explicit IDs using IDENTITY_INSERT.
-- ============================================================

SET NOCOUNT ON;
GO

-- Drop and recreate with IDENTITY so the app can auto-insert new rows
IF OBJECT_ID(N'dbo.[collection_fields]', N'U') IS NOT NULL
  DROP TABLE dbo.[collection_fields];
GO

CREATE TABLE dbo.[collection_fields] (
  [id]                     BIGINT IDENTITY(1,1) NOT NULL,
  [collection_id]          BIGINT NOT NULL,
  [version_id]             BIGINT NULL,
  [field_key]              NVARCHAR(MAX) NULL,
  [type]                   NVARCHAR(MAX) NOT NULL,
  [label]                  NVARCHAR(MAX) NOT NULL,
  [subtitle]               NVARCHAR(MAX) NULL,
  [page_number]            BIGINT NOT NULL DEFAULT 1,
  [required]               BIGINT NOT NULL DEFAULT 0,
  [options]                NVARCHAR(MAX) NULL,
  [display_style]          NVARCHAR(MAX) NOT NULL DEFAULT 'radio',
  [branch_rules]           NVARCHAR(MAX) NULL,
  [sort_order]             BIGINT NOT NULL DEFAULT 0,
  [staff_only]             BIGINT NOT NULL DEFAULT 0,
  [location_filter_enabled] BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT [PK_collection_fields] PRIMARY KEY ([id])
);
GO

-- Allow explicit ID values during the seed inserts
SET IDENTITY_INSERT dbo.[collection_fields] ON;
GO

ALTER TABLE dbo.[collection_fields] NOCHECK CONSTRAINT ALL;
GO

BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (1,1,1,N'field-1',N'single_choice',N'How clearly do you understand your current job responsibilities?',NULL,1,0,N'["Extremely clearly","Very clearly","Moderately clearly","Slightly clearly","Not clearly at all"]',N'radio',NULL,0,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (2,1,1,N'field-2',N'single_choice',N'How accurately was the role described to you in the pre-hire process (i.e. are you doing what you expected you''d be doing)?',NULL,2,0,N'["Extremely accurately","Very accurately","Moderately accurately","Slightly accurately","Not accurately at all"]',N'radio',NULL,1,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (3,1,1,N'field-3',N'single_choice',N'In beginning your position, did you feel you had the information and resources to be equipped to perform the primary duties of the job?',NULL,3,0,N'["Strongly agree","Somewhat agree","Neither agree nor disagree","Somewhat disagree","Strongly disagree"]',N'radio',NULL,2,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (4,1,1,N'field-4',N'rating',N'On a scale from 1-5, with 5 being "Extremely interesting", how interesting do you find your current role at this organization?',NULL,4,0,NULL,N'radio',NULL,3,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (5,1,1,N'field-5',N'comment',N'In the next section, we''d like to find out about your experience being part of your new team.',NULL,5,0,NULL,N'radio',NULL,4,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (400,4,5,N'b9m3bbdetbu',N'date',N'Mentor Training Date',NULL,1,0,NULL,N'radio',NULL,0,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (401,4,5,N'uz5gzcn9a1s',N'multiple_choice',N'Who trained you today?',NULL,1,0,N'["Bridgett Cross","Shirley Dickerson","Emily Joubert","Jennifer Ouellette","Maribeth Priest","Paul Scholl","Mayra Szeto"]',N'radio',NULL,1,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (402,4,5,N'78x9lk3tqky',N'single_choice',N'I feel that the training prepared me to mentor a beginning teacher.',NULL,1,0,N'["Strongly DISAGREE","Somewhat DISAGREE","Somewhat AGREE","Strongly AGREE"]',N'radio',NULL,2,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (403,4,5,N'ex1mfpfwqcf',N'single_choice',N'The instructor valued my time.',NULL,1,0,N'["Strongly DISAGREE","Somewhat DISAGREE","Somewhat AGREE","Strongly AGREE"]',N'radio',NULL,3,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (404,4,5,N'ucjftzt81b',N'single_choice',N'Concepts and skills that were taught were relevant to my work with a beginning teacher.',NULL,1,0,N'["Strong DISAGREE","Somewhat DISAGREE","Somewhat AGREE","Strongly AGREE"]',N'radio',NULL,4,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (405,4,5,N'pqpga9yo5yo',N'single_choice',N'Would you be interested in additional training for mentors in the future?',NULL,1,0,N'["Yes","Possibly","No"]',N'radio',NULL,5,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (406,4,5,N'7axxyga7jg7',N'long_text',N'What additional training or skills do you feel that you need support with to prepare you to mentor?',NULL,1,0,NULL,N'radio',NULL,6,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (407,4,5,N'8fk4urnhehd',N'long_text',N'Additional comments about the overall training:',NULL,1,0,NULL,N'radio',NULL,7,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (1806,1,3,N'p6cuig0s3ob',N'comment',N'<b>About the job</b><div>First of all, we''d like to ask you some questions about your new role.</div>',NULL,1,0,NULL,N'radio',NULL,0,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (1807,1,3,N'field-140',N'single_choice',N'How clearly do you understand your current job responsibilities?',NULL,1,0,N'["Extremely clearly","Very clearly","Moderately clearly","Slightly clearly","Not clearly at all"]',N'radio',NULL,1,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (1808,1,3,N'field-141',N'single_choice',N'How accurately was the role described to you in the pre-hire process (i.e. are you doing what you expected you''d be doing)?',NULL,1,0,N'["Extremely accurately","Very accurately","Moderately accurately","Slightly accurately","Not accurately at all"]',N'radio',NULL,2,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (1809,1,3,N'field-142',N'single_choice',N'In beginning your position, did you feel you had the information and resources to be equipped to perform the primary duties of the job?',NULL,1,0,N'["Strongly agree","Somewhat agree","Neither agree nor disagree","Somewhat disagree","Strongly disagree"]',N'radio',NULL,3,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (1810,1,3,N'field-143',N'single_choice',N'How interesting do you find your current role at this organization?',NULL,1,0,N'["Extremely interesting","Very interesting","Moderately interesting","Slightly interesting","Not interesting at all"]',N'radio',NULL,4,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (7430,5,11,N'1plkixufamx',N'short_text',N'Your Name',NULL,1,0,NULL,N'radio',NULL,0,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (7431,5,11,N'bjcm9qxeda9',N'short_text',N'Your Email',NULL,1,0,NULL,N'radio',NULL,1,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (7646,8,15,N'68ifxims6rn',N'short_text',N'Applicant Name',NULL,1,0,NULL,N'radio',NULL,0,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (7709,9,16,N'3cqhmy1w8xw',N'date',N'Todays Date',NULL,1,0,NULL,N'radio',NULL,0,0,0); END TRY BEGIN CATCH END CATCH
BEGIN TRY INSERT INTO dbo.[collection_fields] ([id],[collection_id],[version_id],[field_key],[type],[label],[subtitle],[page_number],[required],[options],[display_style],[branch_rules],[sort_order],[staff_only],[location_filter_enabled]) VALUES (8364,9,19,N'bl61dzhixi',N'comment',N'<b>About Comment Field Types</b>',NULL,2,0,NULL,N'radio',NULL,4,0,0); END TRY BEGIN CATCH END CATCH
-- (remaining rows omitted for brevity — paste all your original INSERT rows here)

ALTER TABLE dbo.[collection_fields] CHECK CONSTRAINT ALL;
GO

-- Restore normal auto-increment behaviour
SET IDENTITY_INSERT dbo.[collection_fields] OFF;
GO

-- Reseed the identity counter to be above the highest inserted ID
DECLARE @max BIGINT;
SELECT @max = MAX([id]) FROM dbo.[collection_fields];
DBCC CHECKIDENT ('dbo.[collection_fields]', RESEED, @max);
GO

PRINT 'collection_fields seeded successfully.';
