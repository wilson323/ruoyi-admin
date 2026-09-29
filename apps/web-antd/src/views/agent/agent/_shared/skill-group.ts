/**
 * Skill 分组与搜索（Track E3，纯函数）。
 *
 * <p>分组键是**前端派生约定**（name 冒号/斜杠前缀），非后端契约字段——后端
 * SkillOptionVo 只有 name/description（AgentController L125 实证）。派生规则确定性：
 * ① name 含 `:` 取冒号前缀；② 否则含 `/` 取斜杠前缀；③ 都没有归「通用」组。
 * 「通用」组固定排在最后，其余组按 label 字典序（渲染与断言确定性）。
 */

export interface SkillEntry {
  description?: null | string;
  name: string;
}

export interface SkillGroup {
  key: string;
  label: string;
  skills: SkillEntry[];
}

export const SKILL_FALLBACK_GROUP = '通用';

/** 分组键派生（空/非字符串防御归「通用」，不断列表）。 */
export function skillGroupKey(name: string): string {
  if (typeof name !== 'string' || name.trim() === '') return SKILL_FALLBACK_GROUP;
  const colon = name.indexOf(':');
  if (colon > 0) return name.slice(0, colon);
  const slash = name.indexOf('/');
  if (slash > 0) return name.slice(0, slash);
  return SKILL_FALLBACK_GROUP;
}

/** 分组：同名 skill 去重（name 唯一键，后到覆盖前到 description）；组内按 name 字典序。 */
export function groupSkills(skills: SkillEntry[]): SkillGroup[] {
  const byName = new Map<string, SkillEntry>();
  for (const skill of skills) {
    if (typeof skill?.name !== 'string' || skill.name === '') continue;
    byName.set(skill.name, { description: skill.description ?? '', name: skill.name });
  }
  const groups = new Map<string, SkillEntry[]>();
  for (const skill of byName.values()) {
    const key = skillGroupKey(skill.name);
    const list = groups.get(key);
    if (list) {
      list.push(skill);
    } else {
      groups.set(key, [skill]);
    }
  }
  const result: SkillGroup[] = [];
  for (const [label, list] of groups) {
    list.sort((a, b) => a.name.localeCompare(b.name));
    result.push({ key: label, label, skills: list });
  }
  result.sort((a, b) => {
    if (a.label === SKILL_FALLBACK_GROUP) return 1;
    if (b.label === SKILL_FALLBACK_GROUP) return -1;
    return a.label.localeCompare(b.label);
  });
  return result;
}

/**
 * 搜索：name/description 大小写不敏感包含匹配；keyword 空白（trim 后空）返回全量。
 * 匹配在分组前执行（调用方 searchSkills → groupSkills 组合）。
 */
export function searchSkills(skills: SkillEntry[], keyword: string): SkillEntry[] {
  const needle = keyword.trim().toLowerCase();
  if (needle === '') return skills;
  return skills.filter((skill) => {
    const name = skill.name.toLowerCase();
    const description = (skill.description ?? '').toLowerCase();
    return name.includes(needle) || description.includes(needle);
  });
}
