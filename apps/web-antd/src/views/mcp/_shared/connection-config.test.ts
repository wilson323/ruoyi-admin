import { describe, expect, it } from 'vitest';

import {
  buildConfigJson,
  configJsonToDraft,
  emptyConnectionDraft,
  parseConfigJson,
  validateConnectionDraft,
} from './connection-config';

describe('connection-config', () => {
  it('LOCAL：command 必填、args 空串报错；序列化只含 command+args（#20 不发明 env）', () => {
    const draft = { args: ['-y', ' pkg'], baseUrl: '', command: ' npx ' };
    expect(validateConnectionDraft('LOCAL', draft)).toEqual([]);
    expect(buildConfigJson('LOCAL', draft)).toBe(
      JSON.stringify({ args: ['-y', 'pkg'], command: 'npx' }),
    );
    const bad = { args: [''], baseUrl: '', command: '' };
    const errors = validateConnectionDraft('LOCAL', bad);
    expect(errors.some((e) => e.includes('command'))).toBe(true);
    expect(errors.some((e) => e.includes('args[0]'))).toBe(true);
  });

  it('REMOTE：baseUrl 必填 + URL 合法性 + 协议白名单', () => {
    expect(
      validateConnectionDraft('REMOTE', {
        args: [],
        baseUrl: 'https://host/mcp',
        command: '',
      }),
    ).toEqual([]);
    expect(
      validateConnectionDraft('REMOTE', { args: [], baseUrl: '', command: '' }),
    ).toContain('baseUrl 必填');
    expect(
      validateConnectionDraft('REMOTE', {
        args: [],
        baseUrl: 'not a url',
        command: '',
      })[0],
    ).toContain('合法 URL');
    expect(
      validateConnectionDraft('REMOTE', {
        args: [],
        baseUrl: 'ftp://host',
        command: '',
      })[0],
    ).toContain('http/https');
    expect(
      buildConfigJson('REMOTE', {
        args: [],
        baseUrl: ' https://host/mcp ',
        command: '',
      }),
    ).toBe(JSON.stringify({ baseUrl: 'https://host/mcp' }));
  });

  it('高级视图回同步：合法 JSON → 草稿；非法/形状不符 → null（调用方显式报错）', () => {
    expect(parseConfigJson('LOCAL', '{"command":"npx","args":["-y"]}')).toEqual(
      {
        args: ['-y'],
        baseUrl: '',
        command: 'npx',
      },
    );
    expect(parseConfigJson('LOCAL', '{"command":"npx"}')).toBeNull();
    expect(parseConfigJson('REMOTE', '{"baseUrl":123}')).toBeNull();
    expect(parseConfigJson('REMOTE', '{oops')).toBeNull();
    expect(configJsonToDraft('LOCAL', '{oops')).toEqual(emptyConnectionDraft());
    // BUILTIN 无需配置：恒通过、恒不产出 configJson
    expect(validateConnectionDraft('BUILTIN', emptyConnectionDraft())).toEqual(
      [],
    );
  });

  it('契约红线：序列化产物只含后端真实读取键，绝不含 env/headers（#20）', () => {
    const local = buildConfigJson('LOCAL', {
      args: ['-y'],
      baseUrl: 'https://ignored',
      command: 'npx',
    });
    expect(local).not.toMatch(/env|headers/i);
    expect(Object.keys(JSON.parse(local)).sort()).toEqual(['args', 'command']);

    const remote = buildConfigJson('REMOTE', {
      args: ['ignored'],
      baseUrl: 'https://host/mcp',
      command: 'ignored',
    });
    expect(remote).not.toMatch(/env|headers/i);
    expect(Object.keys(JSON.parse(remote))).toEqual(['baseUrl']);
  });
});
