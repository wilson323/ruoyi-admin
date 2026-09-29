import { defineOverridesPreferences } from '@vben/preferences';

/**
 * @description 项目配置文件
 * 只需要覆盖项目中的一部分配置，不需要的配置不用覆盖，会自动使用默认配置
 * !!! 更改配置后请清空缓存，否则可能不生效
 */
export const overridesPreferences = defineOverridesPreferences({
  // overrides
  app: {
    /**
     * 不要动这里  后端路由模式
     */
    accessMode: 'backend',
    /**
     * 2026-09-12 修复：默认首页由模板残留的 /analytics（vben demo 页，路由不在
     * Root 布局树下，logo/首页入口跳过去变成无侧栏顶栏的「全屏」裸页）改为
     * IPD 工作台，与 core.ts Root.redirect 对齐。
     */
    defaultHomePath: '/ipd/workbench',
    /**
     * 不需要refresh token 由后端处理
     */
    enableRefreshToken: false,
    /**
     * 这里可以设置默认头像 url链接或vite导入的图片链接
     */
    // defaultAvatar: '',
    /**
     * 在这里设置应用标题
     */
    name: import.meta.env.VITE_APP_TITLE,
    /**
     * 不支持modal模式 需要改动的地方太多
     * 1. 正常重新登录后不会再触发接口请求 即触发登录超时的页面为空数据
     * 2. 切换租户登录后不会重新加载菜单
     */
    // loginExpiredMode: 'modal',
  },
  footer: {
    /**
     * 不显示footer
     */
    enable: false,
  },
  tabbar: {
    /**
     * 标签tab 持久化 关闭
     */
    persist: false,
    // styleType: 'card',
  },
  theme: {
    /**
     * 浅色sidebar
     */
    semiDarkSidebar: false,
    /**
     * 圆角大小 换算比例为1.6px = 0.1radius
     * 这里为6px 与antd保持一致
     */
    radius: '0.375',
    /**
     * 2026-09-28 颜色一致性（owner 硬约束：颜色系统要与原有 UIUX 一致）
     *
     * Vben 会把主题色以 inline style 写到 <html> 上
     * （packages/@core/preferences/src/update-css-variables.ts 的
     * updateMainColorVariables），优先级高于任何 CSS 文件的 `:root` 规则，
     * 导致 views/ipd/_shared/ipd-theme.css 里的 `:root { --primary: 220 90% 55% }`
     * **从未生效**（运行态实测 --primary 仍是内置 default 主题的 215 100% 54%）。
     * 而 useAntdDesignTokens 又直接从 `--primary` 读 antd 的 colorPrimary，
     * 于是所有 antd / Vben(shadcn) 组件的主色都是默认蓝而不是 IPD 品牌蓝。
     * 在这里对齐 = 单点修复组件层主色，无需改任何 CSS 或业务代码。
     *
     * 为何用 hex 而不是 HSL 字面量（两者均在本机运行态实测过）：
     * 真值源 #245bf4 = rgb(36,91,244) = **hsl(224 91% 55%)**，
     * 而 ipd-theme.css 注释里写的 "#245bf4 = hsl(220 90% 55%)" 是**错误换算**：
     * hsl(220 90% 55%) 实际渲染 rgb(37,106,244)，G 通道偏 15，肉眼可辨。
     * 用 hex 交给 Vben 色阶生成器后得到 rgb(37,92,244)，与真值仅差 1/255（不可辨），
     * 比直写那个错 HSL 值更贴近原有 UIUX。错换算本身属存量债，已登记，本次不扩范围修。
     * 改后需清浏览器偏好缓存（本文件顶部注释所述）才能看到效果；
     * 但 bootstrap.ts 里已用 updatePreferences 强制覆盖老缓存（同 defaultHomePath
     * 模式），所以老用户无需任何操作也会生效。
     */
    colorPrimary: '#245bf4',
    /**
     * 语义色同步对齐 IPD 品牌色（owner 硬约束：颜色系统要与原有 UIUX 一致）：
     * 三个默认值与 var(--ipd-green) / var(--ipd-amber) / var(--ipd-red) 逐值相等，
     * 由 bootstrap.ts 的 updatePreferences 一并强制覆盖老缓存。
     */
    colorSuccess: '#2f9e52',
    colorWarning: '#c98313',
    colorDestructive: '#e45757',
  },
  /**
   * !!! 更改配置后请清空浏览器缓存
   * 在这里更换logo
   * source可选值：
   * 1. 本地public目录下的图片 需要加上/ 比如：/logo.png
   * 2. 网络图片链接
   * 3. vite导入的图片 import xxx from 'xxx.png'
   *
   * !!! 更改配置后请清空浏览器缓存
   */
  // logo: {
  //   enable: true,
  //   source: '',
  // },
});
