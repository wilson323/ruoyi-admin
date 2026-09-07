import type { WorkflowInfo, WorkflowNode } from '../types/index.d';

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import GenericNodeProperty from './GenericNodeProperty.vue';

function createEditor() {
  const node: WorkflowNode = {
    uuid: 'node-fixture',
    title: '参数类型验证',
    workflowUuid: 'workflow-fixture',
    inputConfig: { user_inputs: [], ref_inputs: [] },
    nodeConfig: { enabled: true, count: 3, list: ['a'], settings: { limit: 2 } },
    outputConfig: {},
    positionX: 0,
    positionY: 0,
  };
  const workflow: WorkflowInfo = {
    uuid: node.workflowUuid,
    title: '组件验证',
    nodes: [node],
    edges: [],
  };
  const wrapper = mount(GenericNodeProperty, {
    props: { workflow, wfNode: node, uiWorkflow: { nodes: [], edges: [] } },
  });
  return { node, wrapper };
}

describe('GenericNodeProperty component compatibility', () => {
  it('renders array and object values as real multiline controls', () => {
    const { wrapper } = createEditor();
    const textareas = wrapper.findAll('textarea');
    expect(textareas).toHaveLength(2);
    expect(textareas[0]?.element.value).toBe('[\n  "a"\n]');
    expect(textareas[1]?.element.value).toBe('{\n  "limit": 2\n}');
    wrapper.unmount();
  });

  it('writes valid JSON edits and preserves the last value on invalid JSON', async () => {
    const { node, wrapper } = createEditor();
    const objectInput = wrapper.findAll('textarea')[1];
    expect(objectInput).toBeDefined();
    await objectInput?.setValue('{"limit": 4}');
    expect(node.nodeConfig.settings).toEqual({ limit: 4 });
    await objectInput?.setValue('{');
    expect(node.nodeConfig.settings).toEqual({ limit: 4 });
    wrapper.unmount();
  });

  it('retains boolean values when the actual switch is toggled', async () => {
    const { node, wrapper } = createEditor();
    await wrapper.get('button[role="switch"]').trigger('click');
    expect(node.nodeConfig.enabled).toBe(false);
    wrapper.unmount();
  });
});
