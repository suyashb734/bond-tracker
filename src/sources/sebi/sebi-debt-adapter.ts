import { createHash } from 'node:crypto';
import { NcdPublicIssueRecord, NcdIpoLifecycleStage } from '../../services/ncd-ipo-sync.js';

export type SebiDebtItem = {
  title: string;
  prospectus_url: string;
  issuer_name: string;
  lifecycle_stage: NcdIpoLifecycleStage;
  sha256: string;
};

export function parseSebiDebtCategoryHtml(html: string): SebiDebtItem[] {
  const items: SebiDebtItem[] = [];
  if (!html || typeof html !== 'string') return items;

  // Regex matching SEBI link structures for Debt Offer Documents (ssid=17)
  const linkRegex = /<a[^>]+href=["\']([^"\']+\.html)["\'][^>]*>(.*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = match[1];
    const rawTitle = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const rawTitleLower = rawTitle.toLowerCase();
    if (
      rawTitleLower === 'debt offer document' ||
      rawTitleLower === 'filings' ||
      rawTitleLower === 'home' ||
      rawUrl.endsWith('/filings.html')
    ) {
      continue;
    }

    const prospectusUrl = rawUrl.startsWith('http') ? rawUrl : `https://www.sebi.gov.in${rawUrl}`;
    const cleanIssuer = extractIssuerFromDebtTitle(rawTitle);
    const stage: NcdIpoLifecycleStage = /draft/i.test(rawTitle) ? 'draft_prospectus' : 'open_subscription';
    const sha256 = createHash('sha256').update(`${cleanIssuer}:${prospectusUrl}`).digest('hex');

    items.push({
      title: rawTitle,
      prospectus_url: prospectusUrl,
      issuer_name: cleanIssuer,
      lifecycle_stage: stage,
      sha256
    });
  }

  return items;
}

function extractIssuerFromDebtTitle(title: string): string {
  let name = title.split(/[-–—–]/)[0].trim();
  name = name.replace(/\b(Draft|Shelf|Abridged|Red|Herring|Prospectus|DRHP|RHP|Addendum|Corrigendum)\b.*/gi, '').trim();
  return name.length > 0 ? name : title.trim();
}

export function sebiItemToNcdPublicIssue(item: SebiDebtItem): NcdPublicIssueRecord {
  const issueId = `SEBI-DEBT-${item.sha256.slice(0, 12).toUpperCase()}`;
  return {
    issue_id: issueId,
    issuer_name: item.issuer_name,
    prospectus_url: item.prospectus_url,
    lifecycle_stage: item.lifecycle_stage,
    assigned_isins: [],
    raw_json: JSON.stringify(item)
  };
}
