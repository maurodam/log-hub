export const MAX_RECIPIENTS = 20;

// One "@", no spaces, a dot in the domain part. Deliverability is the SMTP server's job.
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:".]{2,}$/;

export function isEmailAddress(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * Splits typed or pasted text into addresses: separators are commas, semicolons and whitespace;
 * `Name <a@b.c>` keeps only the address.
 */
export function splitRecipients(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .flatMap((segment) => {
      const angle = /<([^<>]+)>/.exec(segment);
      return angle ? [angle[1]] : segment.split(/\s+/);
    })
    .map((part) => part.replace(/^["']+|["']+$/g, '').trim())
    .filter(Boolean);
}

export interface RecipientsUpdate {
  /** New list: previous entries plus the accepted ones. */
  recipients: string[];
  /** Entries that were not added (invalid, duplicate or over the limit), for the input box. */
  rejected: string[];
  /** Why the first rejected entry was not added. */
  error: string | null;
}

/** Adds the addresses in `text` to `current`, rejecting invalid ones, duplicates and overflow. */
export function addRecipients(current: readonly string[], text: string): RecipientsUpdate {
  const recipients = [...current];
  const seen = new Set(current.map((value) => value.toLowerCase()));
  const rejected: string[] = [];
  let error: string | null = null;
  const reject = (entry: string, reason: string) => {
    rejected.push(entry);
    error ??= reason;
  };

  for (const entry of splitRecipients(text)) {
    if (!isEmailAddress(entry)) reject(entry, `"${entry}" is not a valid email address.`);
    else if (seen.has(entry.toLowerCase())) reject(entry, `${entry} is already in the list.`);
    else if (recipients.length >= MAX_RECIPIENTS)
      reject(entry, `At most ${MAX_RECIPIENTS} recipients.`);
    else {
      recipients.push(entry);
      seen.add(entry.toLowerCase());
    }
  }
  return { recipients, rejected, error };
}

/** Validation message for a whole recipient list, or null when it is fine. */
export function recipientsError(recipients: readonly string[]): string | null {
  if (!recipients.length) return 'Add at least one recipient.';
  if (recipients.length > MAX_RECIPIENTS) return `At most ${MAX_RECIPIENTS} recipients.`;
  const invalid = recipients.find((value) => !isEmailAddress(value));
  if (invalid) return `"${invalid}" is not a valid email address.`;
  const lower = recipients.map((value) => value.toLowerCase());
  const duplicate = recipients.find((_, i) => lower.indexOf(lower[i]) !== i);
  return duplicate ? `${duplicate} is listed twice.` : null;
}
