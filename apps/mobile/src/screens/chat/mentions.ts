import { isMentionBoundary, isMentionNameContinuation } from "@openmausbot/phone-protocol/mention-boundary.ts";

export interface Member {
  id: string;
  name: string;
}

/** The `@word` being typed at the end of the draft, or null. */
export function mentionQuery(draft: string): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(draft);
  return match ? match[1]! : null;
}

export function mentionMatches<T extends Member>(members: readonly T[], query: string): T[] {
  const lower = query.toLowerCase();
  return members.filter((member) => member.name.toLowerCase().startsWith(lower));
}

/** Replaces the `@word` being typed with the member's whole name. */
export function insertMention(draft: string, member: Member): string {
  return draft.replace(/@([^\s@]*)$/, `@${member.name} `);
}

/** Whether `@Name` stands as a whole mention somewhere in the text, by the server's own boundary rules. */
function names(text: string, name: string): boolean {
  const tag = `@${name}`;
  for (let at = text.indexOf(tag); at !== -1; at = text.indexOf(tag, at + 1)) {
    if (isMentionBoundary(text, at) && !isMentionNameContinuation(text[at + tag.length])) return true;
  }
  return false;
}

/** Ids of picked members still named in the text when it is sent. */
export function mentionedIds(text: string, picked: readonly Member[]): string[] {
  return [...new Set(picked.filter((member) => names(text, member.name)).map((member) => member.id))];
}
