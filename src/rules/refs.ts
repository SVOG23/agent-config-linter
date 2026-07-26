export type RefKind = 'at-import' | 'md-link' | 'path-token' | 'npm-script';

export interface ExtractedRef {
  kind: RefKind;
  value: string;
  line: number;
}

const AT_IMPORT = /(?:^|[\s(])@([\w~./-]+)/g;
const MD_LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const BACKTICK = /`([^`]+)`/g;
const NPM_SCRIPT = /\b(?:npm|pnpm)\s+run\s+([\w:.-]+)/g;

const EXTENSION = /\.\w{1,8}$/;
/** Values with no slash whose "extension" is a TLD are domains, not files. */
const TLDS = new Set(['com', 'net', 'org', 'io', 'dev', 'ai', 'co', 'edu']);
/** Two bare segments with no extension anywhere is an npm scoped package shape. */
const NPM_SCOPE = /^[a-z0-9~][\w.-]*\/[\w.-]+$/;

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?)]+$/, '');
}

function isAtImportPath(value: string): boolean {
  if (value.startsWith('~')) return false; // user-level, unverifiable
  const hasSlash = value.includes('/');
  const lastSegment = value.slice(value.lastIndexOf('/') + 1);
  const hasExtension = EXTENSION.test(lastSegment);
  if (!hasSlash) {
    if (!hasExtension) return false;
    return !TLDS.has(lastSegment.slice(lastSegment.lastIndexOf('.') + 1));
  }
  if (!hasExtension && NPM_SCOPE.test(value)) return false; // @scope/pkg
  return hasExtension || value.startsWith('./') || value.startsWith('../');
}

function isPathToken(token: string): boolean {
  if (!token.includes('/')) return false;
  const segments = token.split('/');
  const valid = segments.every(
    (s) => s === '.' || s === '..' || (/^[\w.-]+$/.test(s) && s.length > 0),
  );
  if (!valid) return false;
  return EXTENSION.test(segments[segments.length - 1]);
}

/** Pulls file/script references out of instruction-file prose, with 1-based line numbers. */
export function extractRefs(content: string): ExtractedRef[] {
  const refs: ExtractedRef[] = [];
  const lines = content.split('\n');

  lines.forEach((text, index) => {
    const line = index + 1;

    for (const match of text.matchAll(AT_IMPORT)) {
      const value = stripTrailingPunctuation(match[1]);
      if (value && isAtImportPath(value)) refs.push({ kind: 'at-import', value, line });
    }

    for (const match of text.matchAll(MD_LINK)) {
      let value = match[1];
      if (/^(https?:|mailto:|#)/i.test(value) || value.includes('://')) continue;
      value = value.replace(/[#?].*$/, '');
      if (value.length > 0) refs.push({ kind: 'md-link', value, line });
    }

    for (const match of text.matchAll(BACKTICK)) {
      const token = match[1].trim();
      if (isPathToken(token)) refs.push({ kind: 'path-token', value: token, line });
    }

    for (const match of text.matchAll(NPM_SCRIPT)) {
      refs.push({ kind: 'npm-script', value: match[1], line });
    }
  });

  return refs;
}
