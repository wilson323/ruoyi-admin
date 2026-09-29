/**
 * Track E5：McpConnectionForm 组件层单测（纯逻辑面见 connection-config.test.ts）。
 *
 * 契约锁定（断言锁契约而非现状）：
 * - #19 方案 a 空态卡：编辑态默认「连接配置已安全保存，不显示明文」+「留空提交将保留原配置」；
 * - 红线「留空提交保留原值」：edit 未点「替换配置」时 getConfigJson() 恒 null
 *   （tool-drawer 合成时删除 configJson 键 → 后端 applyWriteOnlyConfigPolicy 保留库内原值）；
 * - 痛点②修复：高级视图 JSON 非法显式报错并锁提交（validate 非空 + getConfigJson null）；
 * - #20：渲染面与序列化面均不得出现 env/headers（E-A1 落地前）；
 * - #19 零明文渲染：即便草稿携带密值，空态卡不回显任何明文。
 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';

import McpConnectionForm from './mcp-connection-form.vue';
import {
  emptyConnectionDraft,
  type ConnectionDraft,
  type McpToolType,
} from './connection-config';

const SECRET = 'SECRET-MARKER-8f3a1c';

type ConnVm = {
  getConfigJson: () => null | string;
  validate: () => string[];
};

function mountForm(options: {
  draft?: ConnectionDraft;
  mode: 'create' | 'edit';
  replaced?: boolean;
  type: McpToolType;
}) {
  const wrapper = mount(McpConnectionForm, {
    props: {
      // reactive 代理 = 生产形态（父侧 ref 传入），保证深层改动联动渲染/侦听
      draft: reactive(options.draft ?? emptyConnectionDraft()),
      mode: options.mode,
      replaced: options.replaced ?? false,
      type: options.type,
    },
  });
  return wrapper;
}

function vmOf(wrapper: VueWrapper<any>): ConnVm {
  return wrapper.vm as unknown as ConnVm;
}

async function switchView(wrapper: VueWrapper<any>, value: 'json' | 'structured') {
  const radio = wrapper.find(`input[value="${value}"]`);
  await radio.setValue(true);
}

describe('McpConnectionForm', () => {
  it('方案 a 空态卡（edit 未替换）：文案在位、零明文、validate 恒通过、getConfigJson 恒 null', async () => {
    const wrapper = mountForm({
      // 草稿故意携带密值：任何明文回显都必须红
      draft: {
        args: ['--token', SECRET],
        baseUrl: '',
        command: 'npx',
      },
      mode: 'edit',
      replaced: false,
      type: 'LOCAL',
    });

    const sealed = wrapper.get('[data-testid="mcp-conn-sealed"]');
    expect(sealed.text()).toContain('连接配置已安全保存，不显示明文');
    expect(sealed.text()).toContain('留空提交将保留原配置');
    expect(wrapper.find('[data-testid="mcp-conn-replace"]').exists()).toBe(true);
    // 空态卡是编辑态唯一呈现：结构化表单未展开
    expect(wrapper.find('[data-testid="mcp-conn-command"]').exists()).toBe(false);
    // 零明文渲染（#19）：既不回显密值，也不渲染任何连接键
    expect(wrapper.html()).not.toContain(SECRET);
    expect(wrapper.html()).not.toMatch(/env|headers/i);
    // 红线「留空提交保留原值」：校验恒通过、提交不带 configJson 键
    expect(vmOf(wrapper).validate()).toEqual([]);
    expect(vmOf(wrapper).getConfigJson()).toBeNull();
  });

  it('替换配置 → 结构化填写 → 序列化只含 command+args；取消替换回到留空保留', async () => {
    const wrapper = mountForm({ mode: 'edit', replaced: false, type: 'LOCAL' });
    await wrapper.get('[data-testid="mcp-conn-replace"]').trigger('click');

    await wrapper.get('[data-testid="mcp-conn-command"]').setValue(' npx ');
    await wrapper.get('[data-testid="mcp-conn-arg-add"]').trigger('click');
    await wrapper.get('[data-testid="mcp-conn-arg-0"]').setValue(' -y ');

    // #20：序列化面只含后端真实读取键
    expect(vmOf(wrapper).validate()).toEqual([]);
    const json = vmOf(wrapper).getConfigJson();
    expect(json).toBe(JSON.stringify({ args: ['-y'], command: 'npx' }));
    expect(json).not.toMatch(/env|headers/i);

    // 取消替换（留空保留原配置）→ 红线复位
    const cancelButtons = wrapper
      .findAll('button')
      .filter((b) => b.text().includes('取消替换'));
    expect(cancelButtons).toHaveLength(1);
    await cancelButtons[0]!.trigger('click');
    expect(wrapper.find('[data-testid="mcp-conn-sealed"]').exists()).toBe(true);
    expect(vmOf(wrapper).getConfigJson()).toBeNull();
  });

  it('args 空串行：validate 显式报错、getConfigJson 锁 null（禁止静默提交）', async () => {
    const wrapper = mountForm({ mode: 'create', type: 'LOCAL' });
    await wrapper.get('[data-testid="mcp-conn-command"]').setValue('npx');
    await wrapper.get('[data-testid="mcp-conn-arg-add"]').trigger('click');
    await wrapper.get('[data-testid="mcp-conn-arg-0"]').setValue('   ');

    const errors = vmOf(wrapper).validate();
    expect(errors.some((e) => e.includes('args[0]'))).toBe(true);
    expect(vmOf(wrapper).getConfigJson()).toBeNull();
  });

  it('高级/JSON 视图：非法 JSON 显式报错并锁提交；合法 JSON 回同步草稿', async () => {
    const wrapper = mountForm({ mode: 'create', type: 'LOCAL' });
    await switchView(wrapper, 'json');

    const textarea = wrapper.get('[data-testid="mcp-conn-json"]');
    await textarea.setValue('{oops');
    const errBox = wrapper.get('[data-testid="mcp-conn-json-error"]');
    expect(errBox.text()).toContain('JSON 非法或形状不符');
    expect(errBox.text()).toContain('LOCAL 需 command+args[]');
    // 痛点②契约：非法不再静默——显式报错 + 校验锁提交
    expect(vmOf(wrapper).validate().length).toBeGreaterThan(0);
    expect(vmOf(wrapper).getConfigJson()).toBeNull();

    await textarea.setValue('{"command":"npx","args":["-y"]}');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid="mcp-conn-json-error"]').exists()).toBe(
      false,
    );
    expect(vmOf(wrapper).validate()).toEqual([]);
    expect(vmOf(wrapper).getConfigJson()).toBe(
      JSON.stringify({ args: ['-y'], command: 'npx' }),
    );
  });

  it('REMOTE：baseUrl 必填 + 协议白名单；序列化只含 baseUrl', async () => {
    const wrapper = mountForm({ mode: 'create', type: 'REMOTE' });
    const input = wrapper.get('[data-testid="mcp-conn-base-url"]');

    await input.setValue('ftp://host');
    expect(
      vmOf(wrapper).validate().some((e) => e.includes('http/https')),
    ).toBe(true);
    expect(vmOf(wrapper).getConfigJson()).toBeNull();

    await input.setValue(' https://host/mcp ');
    expect(vmOf(wrapper).validate()).toEqual([]);
    expect(vmOf(wrapper).getConfigJson()).toBe(
      JSON.stringify({ baseUrl: 'https://host/mcp' }),
    );
    // #20：REMOTE 结构化面只有 baseUrl 一个键
    expect(wrapper.html()).not.toMatch(/env|headers/i);
  });

  it('BUILTIN：无需连接配置、恒不产出 configJson', async () => {
    const wrapper = mountForm({ mode: 'create', type: 'BUILTIN' });
    expect(wrapper.get('[data-testid="mcp-conn-builtin"]').text()).toContain(
      '内置工具无需连接配置。',
    );
    expect(vmOf(wrapper).validate()).toEqual([]);
    expect(vmOf(wrapper).getConfigJson()).toBeNull();
    expect(wrapper.html()).not.toMatch(/env|headers/i);
  });
});
