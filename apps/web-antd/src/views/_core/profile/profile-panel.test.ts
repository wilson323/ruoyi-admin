import type { UserProfile } from '#/api/system/profile/model';

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import ProfilePanel from './profile-panel.vue';

vi.mock('@vben/preferences', () => ({
  preferences: { app: { defaultAvatar: '' } },
  usePreferences: () => ({ isDark: { value: false } }),
}));
vi.mock('ant-design-vue', () => ({
  Card: { template: '<div><slot /></div>' },
  Descriptions: { template: '<div><slot /></div>' },
  DescriptionsItem: { template: '<div><slot /></div>' },
  Tag: { template: '<div><slot /></div>' },
  Tooltip: { template: '<div><slot /></div>' },
}));
vi.mock('#/api/system/profile', () => ({ userUpdateAvatar: vi.fn() }));
vi.mock('#/components/cropper', () => ({
  CropperAvatar: { template: '<div />' },
}));

describe('个人资料诗词图片可访问文本', () => {
  it('原诗词图片保留来源并有具体替代文本', () => {
    const wrapper = mount(ProfilePanel, {
      props: {
        profile: {
          user: { nickName: '本人', userName: 'person' },
        } as UserProfile,
      },
    });
    const image = wrapper.get('img');
    expect(image.attributes('src')).toContain(
      'https://v2.jinrishici.com/one.svg',
    );
    expect(image.attributes('alt')).toBe('今日推荐诗词');
    wrapper.unmount();
  });
});
