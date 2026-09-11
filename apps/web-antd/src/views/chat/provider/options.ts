export const providerOptions = [
  { label: 'OpenAI', value: 'openai' },
  { label: '深度求索', value: 'deepseek' },
  { label: '智谱AI', value: 'zhipu' },
  { label: '小米MiMo', value: 'xiaomi' },
  { label: '阿里云百炼', value: 'qianwen' },
  { label: 'PPIO', value: 'ppio' },
  { label: 'MiniMax', value: 'minimax' },
  { label: 'Ollama', value: 'ollama' },
  { label: '自定义 OpenAI', value: 'custom_api' },
  { label: '自定义 Anthropic', value: 'custom_anthropic' },
] as const;

export function getCustomProviderConfig(providerCode: unknown) {
  if (providerCode === 'custom_api') {
    return {
      protocol: 'OpenAI Chat Completions',
      apiHostPlaceholder: 'https://服务商地址/v1',
      apiKeyReference: 'env:CUSTOM_OPENAI_API_KEY',
      baseUrlVariable: 'CUSTOM_OPENAI_BASE_URL',
    };
  }
  if (providerCode === 'custom_anthropic') {
    return {
      protocol: 'Anthropic Messages',
      apiHostPlaceholder: 'https://服务商地址/v1',
      apiKeyReference: 'env:CUSTOM_ANTHROPIC_API_KEY',
      baseUrlVariable: 'CUSTOM_ANTHROPIC_BASE_URL',
    };
  }
  return null;
}

export const providerStatusOptions = [
  { label: '启用', value: '0' },
  { label: '停用', value: '1' },
];
