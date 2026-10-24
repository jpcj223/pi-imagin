export interface CatalogSkill {
  name: string;
  source: string;
  slug: string;
  package: string;
  installs: number;
  official: boolean;
  url: string;
}

export interface SkillCatalogPage {
  items: CatalogSkill[];
  page: number;
  total: number;
  hasNext: boolean;
  searchLimited: boolean;
}

export interface CatalogSkillDetail {
  package: string;
  description: string;
  readmeHtml: string;
  truncated: boolean;
  markdown?: string;
  documentUrl?: string;
  documentPath?: string;
  fullUnavailable?: boolean;
}

export function validSkillSource(source: unknown): source is string {
  return typeof source === "string" && source.length <= 200 && (/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(source) || /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/i.test(source));
}

export function validSkillSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.length <= 200 && /^[a-z0-9][a-z0-9._-]*$/i.test(slug);
}
