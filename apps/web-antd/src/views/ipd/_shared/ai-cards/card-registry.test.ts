/**
 * ai-cards 注册表 + 类型骨架最小测试（P1-05）。
 *
 * 覆盖：注册表 type→(scene, shape) 映射与 Catalog 一致、(type, version) 匹配语义、
 * 4 卡 data interface 的字段面（编译期类型标注 + 运行期字段名对账）。
 * schema 双份对账哨兵（后端 JSON ↔ 前端 TS）在 P1-04 并入契约测试体系，此处不重复。
 */
import { describe, expect, it } from 'vitest';

import {
  CARD_REGISTRY,
  getCardType,
  isCardType,
  listCardTypes,
} from './card-registry';
import type {
  DemandDraftCardData,
  GateConclusionCardData,
  GatePrecheckCardData,
  ProjectCharterCardData,
} from './types';

/** Catalog shape 映射期望（= system_configs ai.suggest.cardCatalog）。 */
const CATALOG_SHAPE: Array<[string, string]> = [
  ['demand.draft', 'draft'],
  ['gate.conclusion', 'decision'],
  ['gate.precheck', 'checklist'],
  ['project.charter', 'compare'],
];

describe('ai-cards/card-registry（P1-05 骨架）', () => {
  it('注册表含且仅含 Catalog 4 个 type，type→shape 逐项一致', () => {
    expect(listCardTypes()).toHaveLength(4);
    for (const [type, shape] of CATALOG_SHAPE) {
      const entry = getCardType(type);
      expect(entry, `type=${type} 应在注册表`).toBeDefined();
      expect(entry?.shape).toBe(shape);
      expect(entry?.version).toBe(1);
    }
  });

  it('getCardType 按 (type, version) 匹配；未知 type 或版本不符返回 undefined', () => {
    expect(getCardType('gate.precheck', 1)?.scene).toBe(
      'gate.precheck-checklist',
    );
    expect(getCardType('gate.precheck', 2)).toBeUndefined();
    expect(getCardType('gate.precheck')).toBeDefined();
    expect(getCardType('unknown.card')).toBeUndefined();
    expect(isCardType('project.charter')).toBe(true);
    expect(isCardType('nope')).toBe(false);
  });

  it('P1-06 静态 import 注册后 4 组件槽位均已就位', () => {
    for (const entry of listCardTypes()) {
      expect(entry.component).toBeDefined();
    }
    expect(Object.keys(CARD_REGISTRY).length).toBe(4);
  });
});

describe('ai-cards/types 字段面（编译期类型标注 + 运行期字段名对账）', () => {
  it('gate.precheck data 字段与 Catalog fields/itemFields 一一对应', () => {
    const data: GatePrecheckCardData = {
      gateCode: 'G1',
      round: 1,
      reviewCount: 2,
      totalElements: 7,
      items: [
        {
          elementId: 101,
          result: 'PASS',
          conditionNote: { path: '/items/0/conditionNote' },
          evidenceRef: 'EV-1',
          leftoverStatus: 'NONE',
        },
      ],
    };
    expect(Object.keys(data).sort()).toEqual([
      'gateCode',
      'items',
      'reviewCount',
      'round',
      'totalElements',
    ]);
    expect(Object.keys(data.items[0]!).sort()).toEqual([
      'conditionNote',
      'elementId',
      'evidenceRef',
      'leftoverStatus',
      'result',
    ]);
  });

  it('gate.conclusion data + item 字段与 Catalog 一一对应', () => {
    const conclusion: GateConclusionCardData = {
      gateCode: 'G2',
      reviews: [
        {
          reviewerType: 'MARKET_PM',
          decision: 'PASS',
          opinion: 'ok',
          round: 1,
        },
      ],
      passCount: 1,
      conditionalCount: 0,
      failCount: 0,
    };
    expect(Object.keys(conclusion).sort()).toEqual([
      'conditionalCount',
      'failCount',
      'gateCode',
      'passCount',
      'reviews',
    ]);
    expect(Object.keys(conclusion.reviews[0]!).sort()).toEqual([
      'decision',
      'opinion',
      'reviewerType',
      'round',
    ]);
  });

  it('project.charter data 字段与 Catalog 一一对应', () => {
    const charter: ProjectCharterCardData = {
      contextProjectId: 1,
      contextProjectCode: 'P-1',
      contextProjectName: '扫地机',
      contextCurrentStage: 'G1',
      contextProductId: 10,
    };
    expect(Object.keys(charter).sort()).toEqual([
      'contextCurrentStage',
      'contextProductId',
      'contextProjectCode',
      'contextProjectId',
      'contextProjectName',
    ]);
  });

  it('demand.draft data + item 字段与 Catalog 一一对应', () => {
    const draft: DemandDraftCardData = {
      contextProjectId: 1,
      contextProjectCode: 'P-1',
      contextProjectName: '扫地机',
      requirements: [
        {
          requirementId: 201,
          title: '拖布自清洁',
          status: 'OPEN',
          source: 'REQ',
        },
      ],
    };
    expect(Object.keys(draft).sort()).toEqual([
      'contextProjectCode',
      'contextProjectId',
      'contextProjectName',
      'requirements',
    ]);
    expect(Object.keys(draft.requirements[0]!).sort()).toEqual([
      'requirementId',
      'source',
      'status',
      'title',
    ]);
  });
});
