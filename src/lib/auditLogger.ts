import { getDb } from './db';

export interface AuditLogEntry {
  id?: string;
  orgId: string;
  userId?: string;
  userName: string;
  action: 
    | 'APPROVE_CATEGORIZATION'
    | 'REJECT_CATEGORIZATION'
    | 'OVERRIDE_CATEGORY'
    | 'APPROVE_MATCH'
    | 'REJECT_MATCH'
    | 'RESOLVE_EXCEPTION'
    | 'DISMISS_EXCEPTION'
    | 'IMPORT_DATA'
    | 'BATCH_APPROVE'
    | 'CREATE_ORGANIZATION'
    | 'CREATE_RULE'
    | 'UPDATE_RULE'
    | 'DELETE_RULE';
  entityType: 'transaction' | 'reconciliation' | 'exception' | 'invoice' | 'bill' | 'dataset' | 'document' | 'organization' | 'rule';
  entityId: string;
  beforeState?: any;
  afterState?: any;
  explanation: string;
}

export async function logAuditEvent(entry: AuditLogEntry): Promise<string> {
  const db = await getDb();
  const id = entry.id || `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  await db.query(
    `INSERT INTO audit_logs (
       id, org_id, user_id, user_name, action, entity_type, entity_id, before_state, after_state, explanation
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
    [
      id,
      entry.orgId,
      entry.userId || 'user-lead-ca',
      entry.userName,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.beforeState ? JSON.stringify(entry.beforeState) : null,
      entry.afterState ? JSON.stringify(entry.afterState) : null,
      entry.explanation
    ]
  );

  return id;
}

export async function recordApproval(params: {
  orgId: string;
  entityType: 'transaction_categorization' | 'reconciliation_match' | 'exception_resolution';
  entityId: string;
  userId?: string;
  userName: string;
  decision: 'approved' | 'rejected' | 'overridden';
  decisionNotes?: string;
}): Promise<string> {
  const db = await getDb();
  const id = `appr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  await db.query(
    `INSERT INTO approvals (id, org_id, entity_type, entity_id, user_id, user_name, decision, decision_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
    [
      id,
      params.orgId,
      params.entityType,
      params.entityId,
      params.userId || 'user-lead-ca',
      params.userName,
      params.decision,
      params.decisionNotes || ''
    ]
  );

  return id;
}
