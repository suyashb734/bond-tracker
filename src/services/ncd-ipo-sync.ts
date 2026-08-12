import { getDatabase, initDatabase } from '../db/index.js';

export type NcdIpoLifecycleStage = 'draft_prospectus' | 'open_subscription' | 'allotment_completed' | 'isin_active_holding';

export type NcdPublicIssueRecord = {
  issue_id: string;
  issuer_name: string;
  open_date?: string | null;
  close_date?: string | null;
  proposed_amount_cr?: number | null;
  prospectus_url?: string | null;
  lifecycle_stage: NcdIpoLifecycleStage;
  assigned_isins?: string[] | null;
  raw_json?: string | null;
  allotment_evidence_url?: string | null;
  correction?: boolean;
};

const STAGE_ORDER: Record<NcdIpoLifecycleStage, number> = {
  draft_prospectus: 1,
  open_subscription: 2,
  allotment_completed: 3,
  isin_active_holding: 4
};

export function upsertNcdPublicIssue(record: NcdPublicIssueRecord): void {
  if (!record.issue_id || typeof record.issue_id !== 'string' || record.issue_id.trim() === '') {
    throw new Error('[NCD IPO Error] issue_id is required.');
  }
  if (!record.issuer_name || typeof record.issuer_name !== 'string' || record.issuer_name.trim() === '') {
    throw new Error('[NCD IPO Error] issuer_name is required.');
  }

  initDatabase();
  const db = getDatabase();

  const isinList = record.assigned_isins ? record.assigned_isins.map((i) => i.trim().toUpperCase()).filter(Boolean) : [];

  if (record.lifecycle_stage === 'isin_active_holding') {
    if (isinList.length === 0) {
      throw new Error('[NCD IPO Error] isin_active_holding stage requires non-empty assigned_isins.');
    }
    if (!record.allotment_evidence_url) {
      throw new Error('[NCD IPO Error] isin_active_holding stage requires allotment_evidence_url.');
    }
  }

  const existing = db.prepare('SELECT lifecycle_stage FROM ncd_public_issues WHERE issue_id = ?').get(record.issue_id) as { lifecycle_stage: NcdIpoLifecycleStage } | undefined;

  if (existing && !record.correction) {
    const currentOrder = STAGE_ORDER[existing.lifecycle_stage];
    const incomingOrder = STAGE_ORDER[record.lifecycle_stage];
    if (incomingOrder < currentOrder) {
      throw new Error(`[NCD IPO Error] Invalid backward transition from ${existing.lifecycle_stage} to ${record.lifecycle_stage}`);
    }
    if (incomingOrder > currentOrder + 1) {
      throw new Error(`[NCD IPO Error] Invalid skipped transition from ${existing.lifecycle_stage} to ${record.lifecycle_stage}`);
    }
  }

  const isinJson = isinList.length > 0 ? JSON.stringify(isinList) : (record.correction ? null : undefined);

  if (existing && !record.correction) {
    db.prepare(`
      UPDATE ncd_public_issues SET
        issuer_name = ?,
        open_date = COALESCE(?, open_date),
        close_date = COALESCE(?, close_date),
        proposed_amount_cr = COALESCE(?, proposed_amount_cr),
        prospectus_url = COALESCE(?, prospectus_url),
        lifecycle_stage = ?,
        assigned_isins = COALESCE(?, assigned_isins),
        raw_json = COALESCE(?, raw_json),
        updated_at = CURRENT_TIMESTAMP
      WHERE issue_id = ?
    `).run(
      record.issuer_name,
      record.open_date ?? null,
      record.close_date ?? null,
      record.proposed_amount_cr ?? null,
      record.prospectus_url ?? null,
      record.lifecycle_stage,
      isinJson ?? null,
      record.raw_json ?? null,
      record.issue_id
    );
  } else {
    db.prepare(`
      INSERT INTO ncd_public_issues (
        issue_id, issuer_name, open_date, close_date, proposed_amount_cr,
        prospectus_url, lifecycle_stage, assigned_isins, raw_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(issue_id) DO UPDATE SET
        issuer_name = excluded.issuer_name,
        open_date = excluded.open_date,
        close_date = excluded.close_date,
        proposed_amount_cr = excluded.proposed_amount_cr,
        prospectus_url = excluded.prospectus_url,
        lifecycle_stage = excluded.lifecycle_stage,
        assigned_isins = excluded.assigned_isins,
        raw_json = excluded.raw_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      record.issue_id,
      record.issuer_name,
      record.open_date ?? null,
      record.close_date ?? null,
      record.proposed_amount_cr ?? null,
      record.prospectus_url ?? null,
      record.lifecycle_stage,
      isinJson ?? null,
      record.raw_json ?? null
    );
  }
}
