import { createHash } from 'node:crypto';
import pdfParse from 'pdf-parse';

export type ParsedTermSheet = {
  sha256: string;
  text_length: number;
  page_count: number | null;
  face_value: number | null;
  coupon_rate: number | null;
  payout_frequency: 'monthly' | 'quarterly' | 'semi_annually' | 'annually' | 'cumulative' | 'unknown';
  day_count_convention: 'Actual/365' | 'Actual/360' | 'Actual/Actual' | '30/360' | 'unknown';
  maturity_date: string | null;
  redemption_events: Array<{ due_date: string; percentage: number | null; principal_amount: number | null }>;
};

export async function parseTermSheetPdf(pdfBuffer: Buffer): Promise<ParsedTermSheet> {
  const sha256 = createHash('sha256').update(pdfBuffer).digest('hex');
  let text = '';
  let pageCount: number | null = null;

  try {
    const parsed = await pdfParse(pdfBuffer);
    text = parsed.text || '';
    pageCount = typeof parsed.numpages === 'number' ? parsed.numpages : null;
  } catch {
    // Only a controlled fallback for plain-text fixtures; no values are fabricated.
    text = pdfBuffer.toString('utf8');
  }

  const faceValue = firstAmount(text, /(?:face value|nominal value|par value)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i);
  const coupon = firstNumber(text, /(?:coupon rate|interest rate)\s*[:\-]?\s*([\d]+(?:\.\d+)?)\s*%/i);
  const maturity = firstDate(text, /(?:date of maturity|maturity date|redemption date)\s*[:\-]?\s*([^\n;,]+)/i);

  let frequency: ParsedTermSheet['payout_frequency'] = 'unknown';
  if (/monthly|twelve times/i.test(text)) frequency = 'monthly';
  else if (/quarterly|four times/i.test(text)) frequency = 'quarterly';
  else if (/semi[- ]annual|twice/i.test(text)) frequency = 'semi_annually';
  else if (/annual|once a year/i.test(text)) frequency = 'annually';
  else if (/cumulative|no periodic interest/i.test(text)) frequency = 'cumulative';

  let dayCount: ParsedTermSheet['day_count_convention'] = 'unknown';
  if (/actual\s*\/\s*365/i.test(text)) dayCount = 'Actual/365';
  else if (/actual\s*\/\s*360/i.test(text)) dayCount = 'Actual/360';
  else if (/actual\s*\/\s*actual/i.test(text)) dayCount = 'Actual/Actual';
  else if (/30\s*\/\s*360/i.test(text)) dayCount = '30/360';

  return {
    sha256,
    text_length: text.length,
    page_count: pageCount,
    face_value: faceValue,
    coupon_rate: coupon,
    payout_frequency: frequency,
    day_count_convention: dayCount,
    maturity_date: maturity,
    redemption_events: parseRedemptionEvents(text)
  };
}

function firstAmount(text: string, regex: RegExp): number | null {
  const match = text.match(regex);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function firstNumber(text: string, regex: RegExp): number | null {
  const match = text.match(regex);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function firstDate(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match ? normalizeDate(match[1]) : null;
}

function normalizeDate(raw: string): string | null {
  const value = raw.replace(/(?:st|nd|rd|th)/gi, '').trim();
  const iso = value.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const numeric = value.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  const named = value.match(/(\d{1,2})[ -]+([A-Za-z]+)[ -]+(\d{4})/);
  if (named) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.findIndex((m) => named[2].toLowerCase().startsWith(m));
    if (month >= 0) return `${named[3]}-${String(month + 1).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
  }
  return null;
}

function parseRedemptionEvents(text: string): ParsedTermSheet['redemption_events'] {
  const events: ParsedTermSheet['redemption_events'] = [];
  const regex = /(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*[:\-]?\s*(?:(\d+(?:\.\d+)?)\s*%\s*)?(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const dueDate = normalizeDate(match[1]);
    const principal = Number(match[3].replace(/,/g, ''));
    if (dueDate && Number.isFinite(principal)) {
      events.push({ due_date: dueDate, percentage: match[2] ? Number(match[2]) : null, principal_amount: principal });
    }
  }
  return events;
}
