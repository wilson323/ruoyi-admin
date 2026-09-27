/**
 * P1-04 schema 双份对账哨兵（前端侧）：types.ts 4 个 data interface（+3 个 item interface）
 * 与 card-registry 条目 ↔ Catalog JSON 逐字段双向对账（零增删，含 items/reviews/requirements
 * 的 itemFields 子字段）。
 *
 * <p>⚠️ fixture 必须与 DB 同文（唯一 schema 事实源 = system_configs 行
 * config_key='ai.suggest.cardCatalog'，id=1948091001）。取数探针（只读；凭证在
 * defaults-extra-file，不上命令行）：
 * <pre>
 * mysql --defaults-extra-file=/Users/mac/Documents/ruoyi-ai/.codex/ipd-dev/config/mysql-client.cnf ipd_dev --vertical -e "SELECT config_value FROM system_configs WHERE config_key='ai.suggest.cardCatalog'"
 * </pre>
 *
 * <p>fixture 与后端导出（ruoyi-ipd AiSuggestionCardTest.CATALOG_JSON）差异说明：schema 面
 * （type/version/scene/shape/fields/itemFields/sourceRefs）全同；唯一差异是 gate.conclusion.description
 * 说明文案的空白字符（DB 原文 "+" 后双空格、"建议区" 后多一空格），description 非 schema 字段，
 * 不参与对账。
 *
 * <p>对账两段式：编译期 = `satisfies SchemaOf<T>` 把 descriptor 钉在 types.ts interface 上
 * （字段增删/改型即 pnpm run check:type 报错）；运行期 = descriptor/注册表 ↔ fixture 逐字段
 * 双向对账。两段合起来即 types.ts + card-registry ↔ DB Catalog 的双向哨兵。
 */
import { describe, expect, it } from 'vitest';

import { getCardType, listCardTypes } from './card-registry';
import type {
  AiCardEnvelope,
  AiCardType,
  DemandDraftCardData,
  DemandDraftRequirementData,
  GateConclusionCardData,
  GateConclusionReviewData,
  GatePrecheckCardData,
  GatePrecheckItemData,
  ProjectCharterCardData,
} from './types';

/** Catalog type 名（= Catalog fields[].type 取值面）。 */
type CatalogTypeName = 'array<object>' | 'number' | 'string';

/** Catalog 字段声明（= system_configs config_value 的 fields/itemFields 形态）。 */
interface CatalogFieldDef {
  itemFields?: CatalogFieldDef[];
  name: string;
  source: string;
  type: CatalogTypeName;
}

/** Catalog 卡定义。 */
interface CatalogCardDef {
  fields: CatalogFieldDef[];
  scene: string;
  shape: string;
  sourceRefs: string[];
  type: string;
  version: number;
}

/** Catalog 文档。 */
interface CatalogDef {
  cards: CatalogCardDef[];
  catalogVersion: number;
}

// ---- Catalog fixture（DB 同文快照；改动必须先改 DB 再同步此处，禁单侧改动） ----

const CATALOG = JSON.parse(`
{
  "catalogVersion": 1,
  "description": "R232-P1-02 AI 建议卡 schema Catalog（唯一 schema 事实源）；data 值经 sourceRefs 回读业务表（R3），无源字段不进 schema",
  "cards": [
    {
      "type": "gate.precheck",
      "version": 1,
      "scene": "gate.precheck-checklist",
      "shape": "checklist",
      "description": "Gate 预检清单卡（清单型）：要素逐项判定事实（gate_element_results/gate_reviews）；AI 清单建议在 markdown 建议区",
      "fields": [
        {
          "name": "gateCode",
          "type": "string",
          "source": "gate_reviews.gate_code"
        },
        {
          "name": "round",
          "type": "number",
          "source": "gate_reviews.round"
        },
        {
          "name": "reviewCount",
          "type": "number",
          "source": "gate_reviews.id"
        },
        {
          "name": "totalElements",
          "type": "number",
          "source": "gate_element_results.id"
        },
        {
          "name": "items",
          "type": "array<object>",
          "source": "gate_element_results",
          "itemFields": [
            {
              "name": "elementId",
              "type": "number",
              "source": "gate_element_results.element_id"
            },
            {
              "name": "result",
              "type": "string",
              "source": "gate_element_results.result"
            },
            {
              "name": "conditionNote",
              "type": "string",
              "source": "gate_element_results.condition_note"
            },
            {
              "name": "evidenceRef",
              "type": "string",
              "source": "gate_element_results.evidence_ref"
            },
            {
              "name": "leftoverStatus",
              "type": "string",
              "source": "gate_element_results.leftover_status"
            }
          ]
        }
      ],
      "sourceRefs": [
        "gateId",
        "reviewIds",
        "elementResultIds"
      ]
    },
    {
      "type": "gate.conclusion",
      "version": 1,
      "scene": "gate.conclusion-draft",
      "shape": "decision",
      "description": "Gate 结论草稿卡（判定型）：签署决定事实（gate_reviews）+  要素结果计数（gate_element_results.result 聚合）；AI 结论草稿在 markdown 建议区 （LLM 复述值不进 data）",
      "fields": [
        {
          "name": "gateCode",
          "type": "string",
          "source": "gate_reviews.gate_code"
        },
        {
          "name": "reviews",
          "type": "array<object>",
          "source": "gate_reviews",
          "itemFields": [
            {
              "name": "reviewerType",
              "type": "string",
              "source": "gate_reviews.reviewer_type"
            },
            {
              "name": "decision",
              "type": "string",
              "source": "gate_reviews.decision"
            },
            {
              "name": "opinion",
              "type": "string",
              "source": "gate_reviews.opinion"
            },
            {
              "name": "round",
              "type": "number",
              "source": "gate_reviews.round"
            }
          ]
        },
        {
          "name": "passCount",
          "type": "number",
          "source": "gate_element_results.result"
        },
        {
          "name": "conditionalCount",
          "type": "number",
          "source": "gate_element_results.result"
        },
        {
          "name": "failCount",
          "type": "number",
          "source": "gate_element_results.result"
        }
      ],
      "sourceRefs": [
        "gateId",
        "reviewIds",
        "elementResultIds"
      ]
    },
    {
      "type": "project.charter",
      "version": 1,
      "scene": "project.create.suggest",
      "shape": "compare",
      "description": "立项要点卡（对比型）：当前项目上下文事实（projects）对照 AI 立项建议（markdown 建议区）；目标/范围/干系人建议无 projects 落点列，不进 schema（无源不进 schema）",
      "fields": [
        {
          "name": "contextProjectId",
          "type": "number",
          "source": "projects.id"
        },
        {
          "name": "contextProjectCode",
          "type": "string",
          "source": "projects.code"
        },
        {
          "name": "contextProjectName",
          "type": "string",
          "source": "projects.name"
        },
        {
          "name": "contextCurrentStage",
          "type": "string",
          "source": "projects.current_stage"
        },
        {
          "name": "contextProductId",
          "type": "number",
          "source": "projects.product_id"
        }
      ],
      "sourceRefs": [
        "projectId"
      ]
    },
    {
      "type": "demand.draft",
      "version": 1,
      "scene": "demand.create.from-requirement",
      "shape": "draft",
      "description": "需求单草稿卡（草稿型）：项目锚 + 需求池来源事实（projects/requirements）；AI 规范化草稿在 markdown 建议区；分类/优先级/验收标准建议无 requirements 落点列，不进 schema（无源不进 schema）",
      "fields": [
        {
          "name": "contextProjectId",
          "type": "number",
          "source": "projects.id"
        },
        {
          "name": "contextProjectCode",
          "type": "string",
          "source": "projects.code"
        },
        {
          "name": "contextProjectName",
          "type": "string",
          "source": "projects.name"
        },
        {
          "name": "requirements",
          "type": "array<object>",
          "source": "requirements",
          "itemFields": [
            {
              "name": "requirementId",
              "type": "number",
              "source": "requirements.id"
            },
            {
              "name": "title",
              "type": "string",
              "source": "requirements.title"
            },
            {
              "name": "status",
              "type": "string",
              "source": "requirements.status"
            },
            {
              "name": "source",
              "type": "string",
              "source": "requirements.source"
            }
          ]
        }
      ],
      "sourceRefs": [
        "projectId",
        "requirementIds"
      ]
    }
  ]
}
`) as CatalogDef;

// ---- 编译期对账：descriptor 钉在 types.ts interface 上（增删/改型即 check:type 报错） ----

/**
 * interface 槽位 → Catalog 类型名的编译期映射：CardDynString/纯 string 槽位→'string'，
 * number→'number'，数组→'array<object>'（与 Catalog type 名一一对应）。
 */
type SchemaOf<T> = {
  [K in keyof T]-?: T[K] extends number
    ? 'number'
    : T[K] extends readonly unknown[]
      ? 'array<object>'
      : 'string';
};

/** gate.precheck.items[] ↔ Catalog itemFields。 */
const GATE_PRECHECK_ITEM_SCHEMA = {
  elementId: 'number',
  result: 'string',
  conditionNote: 'string',
  evidenceRef: 'string',
  leftoverStatus: 'string',
} satisfies SchemaOf<GatePrecheckItemData>;

/** gate.precheck.data ↔ Catalog fields。 */
const GATE_PRECHECK_SCHEMA = {
  gateCode: 'string',
  round: 'number',
  reviewCount: 'number',
  totalElements: 'number',
  items: 'array<object>',
} satisfies SchemaOf<GatePrecheckCardData>;

/** gate.conclusion.reviews[] ↔ Catalog itemFields。 */
const GATE_CONCLUSION_ITEM_SCHEMA = {
  reviewerType: 'string',
  decision: 'string',
  opinion: 'string',
  round: 'number',
} satisfies SchemaOf<GateConclusionReviewData>;

/** gate.conclusion.data ↔ Catalog fields。 */
const GATE_CONCLUSION_SCHEMA = {
  gateCode: 'string',
  reviews: 'array<object>',
  passCount: 'number',
  conditionalCount: 'number',
  failCount: 'number',
} satisfies SchemaOf<GateConclusionCardData>;

/** project.charter.data ↔ Catalog fields。 */
const PROJECT_CHARTER_SCHEMA = {
  contextProjectId: 'number',
  contextProjectCode: 'string',
  contextProjectName: 'string',
  contextCurrentStage: 'string',
  contextProductId: 'number',
} satisfies SchemaOf<ProjectCharterCardData>;

/** demand.draft.requirements[] ↔ Catalog itemFields。 */
const DEMAND_DRAFT_ITEM_SCHEMA = {
  requirementId: 'number',
  title: 'string',
  status: 'string',
  source: 'string',
} satisfies SchemaOf<DemandDraftRequirementData>;

/** demand.draft.data ↔ Catalog fields。 */
const DEMAND_DRAFT_SCHEMA = {
  contextProjectId: 'number',
  contextProjectCode: 'string',
  contextProjectName: 'string',
  requirements: 'array<object>',
} satisfies SchemaOf<DemandDraftCardData>;

/** cardPayload 信封四键 ↔ 后端契约（增删键即 check:type 报错）。 */
const ENVELOPE_KEYS = {
  data: true,
  sourceRefs: true,
  type: true,
  version: true,
} satisfies Record<keyof AiCardEnvelope, true>;

/** 一卡一份对账用例（data descriptor + 数组字段的 itemFields descriptor）。 */
interface CardReconcileCase {
  data: Record<string, CatalogTypeName>;
  itemSchemas: Record<string, Record<string, CatalogTypeName>>;
  type: AiCardType;
}

const RECONCILE_CASES: readonly CardReconcileCase[] = [
  {
    type: 'gate.precheck',
    data: GATE_PRECHECK_SCHEMA,
    itemSchemas: { items: GATE_PRECHECK_ITEM_SCHEMA },
  },
  {
    type: 'gate.conclusion',
    data: GATE_CONCLUSION_SCHEMA,
    itemSchemas: { reviews: GATE_CONCLUSION_ITEM_SCHEMA },
  },
  {
    type: 'project.charter',
    data: PROJECT_CHARTER_SCHEMA,
    itemSchemas: {},
  },
  {
    type: 'demand.draft',
    data: DEMAND_DRAFT_SCHEMA,
    itemSchemas: { requirements: DEMAND_DRAFT_ITEM_SCHEMA },
  },
];

// ---- 运行期对账：descriptor/注册表 ↔ fixture 逐字段双向（零增删） ----

/** descriptor ↔ Catalog fields 逐字段双向对账：名字双向零增删 + 类型逐字段一致 + itemFields 有无对齐。 */
function expectSchemaMatchesFields(
  schema: Record<string, CatalogTypeName>,
  fields: CatalogFieldDef[],
  where: string,
): void {
  const schemaNames = Object.keys(schema);
  const catalogNames = fields.map((f) => f.name);
  expect(
    schemaNames.filter((n) => !catalogNames.includes(n)),
    `${where}: schema 多出的字段（Catalog 未声明，必须零增项）`,
  ).toEqual([]);
  expect(
    catalogNames.filter((n) => !schemaNames.includes(n)),
    `${where}: Catalog 多出的字段（interface 未声明，必须零缺失）`,
  ).toEqual([]);
  for (const f of fields) {
    expect(schema[f.name], `${where}.${f.name} 类型`).toBe(f.type);
    if (f.type === 'array<object>') {
      expect(f.itemFields, `${where}.${f.name} 应声明 itemFields`).toBeDefined();
    } else {
      expect(f.itemFields, `${where}.${f.name} 不应声明 itemFields`).toBeUndefined();
    }
  }
}

describe('P1-04 对账哨兵：types.ts ↔ Catalog 逐字段双向对账', () => {
  for (const c of RECONCILE_CASES) {
    it(`${c.type}：data + itemFields 与 Catalog 逐字段双向对账（零增删）`, () => {
      const card = CATALOG.cards.find((k) => k.type === c.type);
      expect(card, `${c.type} 应在 Catalog`).toBeDefined();
      expectSchemaMatchesFields(c.data, card!.fields, `${c.type}.data`);
      for (const [fieldName, itemSchema] of Object.entries(c.itemSchemas)) {
        const field = card!.fields.find((f) => f.name === fieldName);
        expect(field?.itemFields, `${c.type}.${fieldName} 应声明 itemFields`).toBeDefined();
        expectSchemaMatchesFields(
          itemSchema,
          field!.itemFields!,
          `${c.type}.${fieldName}.itemFields`,
        );
      }
      // 反向补漏：Catalog 里每个 array<object> 字段都必须有 itemFields 对账用例（items/reviews/requirements 全覆盖）
      const arrayFields = card!.fields
        .filter((f) => f.type === 'array<object>')
        .map((f) => f.name)
        .sort();
      expect(Object.keys(c.itemSchemas).sort()).toEqual(arrayFields);
    });
  }
});

describe('P1-04 对账哨兵：card-registry ↔ Catalog 条目双向对账', () => {
  it('注册表条目 ↔ Catalog 4 卡逐项一致（type/version/scene/shape，双向零增删）', () => {
    const entries = listCardTypes();
    expect(entries).toHaveLength(CATALOG.cards.length);
    expect(entries.map((e) => e.type).sort()).toEqual(
      CATALOG.cards.map((c) => c.type).sort(),
    );
    for (const card of CATALOG.cards) {
      const entry = getCardType(card.type, card.version);
      expect(entry, `${card.type}@v${card.version} 应命中注册表`).toBeDefined();
      expect(entry?.type).toBe(card.type);
      expect(entry?.version).toBe(card.version);
      expect(entry?.scene).toBe(card.scene);
      expect(entry?.shape).toBe(card.shape);
    }
  });

  it('catalogVersion=1 锚定 + cardPayload 信封四键逐字对齐', () => {
    expect(CATALOG.catalogVersion).toBe(1);
    expect(Object.keys(ENVELOPE_KEYS).sort()).toEqual([
      'data',
      'sourceRefs',
      'type',
      'version',
    ]);
  });
});
