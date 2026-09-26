
(23 rows affected)

(5 rows affected)

(3 rows affected)

(4 rows affected)

(14 rows affected)

(12 rows affected)

(4 rows affected)

(1 row affected)

(245 rows affected)

(1 row affected)

(5 rows affected)

(2 rows affected)

(15 rows affected)

(5 rows affected)

(2 rows affected)
Msg 547, Level 16, State 0, Line 1369
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_approval_workflow_approver_instances_stage_instance_id". The conflict occurred in database "wcpss-data-collection", table "dbo.approval_workflow_stage_instances", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 1392
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_approval_workflow_history_workflow_instance_id". The conflict occurred in database "wcpss-data-collection", table "dbo.approval_workflow_instances", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 1437
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_approval_workflow_instances_collection_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collections", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 1451
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_approval_workflow_stage_instances_workflow_instance_id". The conflict occurred in database "wcpss-data-collection", table "dbo.approval_workflow_instances", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 1465
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_collection_fields_collection_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collections", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 1729
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_collection_response_values_field_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collection_fields", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 2730
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_collection_response_values_field_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collection_fields", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 3731
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_collection_response_values_field_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collection_fields", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 4181
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_collection_responses_collection_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collections", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 4356
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_collection_ticket_templates_collection_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collections", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 4369
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_collection_versions_collection_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collections", column 'id'.
The statement has been terminated.

(14 rows affected)
Msg 547, Level 16, State 0, Line 4419
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_notification_deliveries_event_id". The conflict occurred in database "wcpss-data-collection", table "dbo.notification_events", column 'id'.
The statement has been terminated.

(30 rows affected)
Msg 547, Level 16, State 0, Line 4565
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_response_attachments_field_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collection_fields", column 'id'.
The statement has been terminated.

(2 rows affected)
Msg 547, Level 16, State 0, Line 4581
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_submission_comments_response_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collection_responses", column 'id'.
The statement has been terminated.

(18 rows affected)
Msg 547, Level 16, State 0, Line 4610
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_ticket_history_ticket_response_id". The conflict occurred in database "wcpss-data-collection", table "dbo.ticket_responses", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 4646
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_ticket_response_values_ticket_field_id". The conflict occurred in database "wcpss-data-collection", table "dbo.ticket_fields", column 'id'.
The statement has been terminated.
Msg 547, Level 16, State 0, Line 4689
The INSERT statement conflicted with the FOREIGN KEY constraint "FK_ticket_responses_collection_response_id". The conflict occurred in database "wcpss-data-collection", table "dbo.collection_responses", column 'id'.
The statement has been terminated.
Schema + data script complete.