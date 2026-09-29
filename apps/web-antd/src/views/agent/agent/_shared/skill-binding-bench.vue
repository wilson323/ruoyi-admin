<script setup lang="ts">
/**
 * Skill 分组绑定台（Track E3）：左栏分组勾选（搜索过滤）+ 右栏 SKILL.md
 * front-matter 预览与反向依赖。
 *
 * <p>值面协议：v-model = string[]（= AgentVO.skillNames），与 useVbenForm 隐藏
 * 字段做显式合成（E5 同款模式，见 E3-4）。SKILL.md **正文**预览依赖后端读接口
 * E3-BE-1（未提供）：预览区如实标注只展示 front-matter，不发幽灵请求（#20）。
 * 反向依赖 = E1 的 buildSkillReverseDeps（agentList 客户端计算，零后端改动）。
 */
import type { SkillOption } from '#/api/agent/agent/model';

import type { ReverseDep } from '../../../mcp/_shared/tool-reverse-deps';

import { computed, onMounted, ref, watch } from 'vue';

import type { CheckboxChangeEvent } from 'ant-design-vue/es/checkbox/interface';

import {
  Checkbox as ACheckbox,
  InputSearch as AInputSearch,
} from 'ant-design-vue';

import { agentList, agentSkillOptions } from '#/api/agent/agent';

import {
  buildSkillReverseDeps,
  reverseDepsOf,
} from '../../../mcp/_shared/tool-reverse-deps';
import { groupSkills, searchSkills, skillGroupKey } from './skill-group';

const props = defineProps<{ modelValue: string[] }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void;
}>();

const keyword = ref('');
const skills = ref<SkillOption[]>([]);
const loadError = ref(false);
const previewName = ref<null | string>(null);
const reverseDepMap = ref(new Map<string, ReverseDep[]>());
const depsIncomplete = ref(false);

const groups = computed(() =>
  groupSkills(searchSkills(skills.value, keyword.value)),
);

const totalSkills = computed(() => skills.value.length);

const previewSkill = computed(
  () => skills.value.find((skill) => skill.name === previewName.value) ?? null,
);

const previewGroup = computed(() =>
  previewSkill.value ? skillGroupKey(previewSkill.value.name) : '',
);

const previewDeps = computed(() =>
  previewName.value
    ? reverseDepsOf(reverseDepMap.value, previewName.value)
    : [],
);

const selectedSet = computed(() => new Set(props.modelValue));

function isChecked(name: string): boolean {
  return selectedSet.value.has(name);
}

/**
 * 值面载入自动预览：编辑态打开（modelValue 非空且尚未预览）时自动预览第一个
 * 已绑定技能，右栏即刻呈现 SKILL.md front-matter（点击行预览仍然保留）。
 */
watch(
  () => props.modelValue,
  (value) => {
    if (previewName.value === null && value.length > 0) {
      previewName.value = value[0] ?? null;
    }
  },
  { immediate: true },
);

function toggleSkill(name: string, checked: boolean) {
  const next = new Set(selectedSet.value);
  if (checked) {
    next.add(name);
  } else {
    next.delete(name);
  }
  emit('update:modelValue', [...next]);
}

function handlePreview(name: string) {
  previewName.value = name;
}

onMounted(async () => {
  try {
    skills.value = await agentSkillOptions();
  } catch {
    loadError.value = true;
    skills.value = [];
  }
  try {
    const collected: Awaited<ReturnType<typeof agentList>>['rows'] = [];
    let total = Number.POSITIVE_INFINITY;
    for (let pageNum = 1; pageNum <= 20; pageNum += 1) {
      const result = await agentList({ pageNum, pageSize: 100 });
      collected.push(...result.rows);
      total = result.total;
      if (collected.length >= total) break;
    }
    depsIncomplete.value = collected.length < total;
    reverseDepMap.value = buildSkillReverseDeps(collected);
  } catch {
    depsIncomplete.value = true;
    reverseDepMap.value = new Map();
  }
});
</script>

<template>
  <div class="ipd-skill-bench">
    <div class="ipd-skill-bench__left">
      <div class="ipd-skill-bench__bar">
        <a-input-search
          v-model:value="keyword"
          allow-clear
          placeholder="搜索技能（名称或描述）"
          size="small"
        />
        <span class="ipd-skill-bench__meta">
          共 {{ totalSkills }} 个技能 / 已绑定 {{ modelValue.length }} 个
        </span>
      </div>

      <div v-if="loadError" class="ipd-skill-bench__empty">
        技能清单加载失败：可稍后重试（不显示缓存假数据）。
      </div>
      <div v-else-if="groups.length === 0" class="ipd-skill-bench__empty">
        没有匹配「{{ keyword }}」的技能。
      </div>

      <div
        v-for="group in groups"
        :key="group.key"
        class="ipd-skill-bench__group"
      >
        <div class="ipd-skill-bench__group-head">
          <span class="ipd-skill-bench__group-label">{{ group.label }}</span>
          <span class="ipd-skill-bench__meta"
            >{{ group.skills.length }} 个</span
          >
        </div>
        <div class="ipd-skill-bench__cards">
          <div
            v-for="skill in group.skills"
            :key="skill.name"
            class="ipd-skill-bench__row"
            :class="{ 'is-preview': previewName === skill.name }"
            role="button"
            tabindex="0"
            @click="handlePreview(skill.name)"
            @keydown.enter="handlePreview(skill.name)"
            @keydown.space.prevent="handlePreview(skill.name)"
          >
            <div class="ipd-skill-bench__card-head">
              <span class="ipd-skill-bench__name">{{ skill.name }}</span>
              <a-checkbox
                :checked="isChecked(skill.name)"
                :aria-label="`绑定技能 ${skill.name}`"
                @click.stop
                @change="
                  (e: CheckboxChangeEvent) =>
                    toggleSkill(skill.name, e.target.checked)
                "
              />
            </div>
            <span class="ipd-skill-bench__desc">
              {{ skill.description || '（无描述）' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="ipd-skill-bench__right">
      <template v-if="previewSkill">
        <div class="ipd-skill-bench__panel">
          <div class="ipd-skill-bench__panel-title">
            SKILL.md 预览（front-matter）
          </div>
          <div class="ipd-skill-bench__field">
            <span class="ipd-skill-bench__field-key">name</span>
            <span class="ipd-skill-bench__field-value">{{
              previewSkill.name
            }}</span>
          </div>
          <div class="ipd-skill-bench__field">
            <span class="ipd-skill-bench__field-key">group</span>
            <span class="ipd-skill-bench__field-value">{{ previewGroup }}</span>
          </div>
          <div class="ipd-skill-bench__field">
            <span class="ipd-skill-bench__field-key">description</span>
            <span class="ipd-skill-bench__field-value">
              {{ previewSkill.description || '（无描述）' }}
            </span>
          </div>
          <div class="ipd-skill-bench__notice">
            SKILL.md 正文预览依赖后端读接口（E3-BE-1，未提供）：当前仅展示
            front-matter（skillOptions 契约只含
            name/description），不发起正文请求。
          </div>
        </div>

        <div class="ipd-skill-bench__panel">
          <div class="ipd-skill-bench__panel-title">
            反向依赖（绑定该技能的 Agent）
          </div>
          <div v-if="depsIncomplete" class="ipd-skill-bench__empty">
            Agent 扫描未完成，以下结果仅代表已读取范围。
          </div>
          <div v-if="previewDeps.length > 0" class="ipd-skill-bench__deps">
            <div
              v-for="dep in previewDeps"
              :key="dep.agentId"
              class="ipd-skill-bench__field"
            >
              <span class="ipd-skill-bench__field-key">Agent</span>
              <span class="ipd-skill-bench__field-value">
                {{ dep.agentName }}（ID {{ dep.agentId }}）
              </span>
            </div>
          </div>
          <div v-else class="ipd-skill-bench__empty">
            {{
              depsIncomplete
                ? '绑定数据未完整加载；已扫描范围内未发现，不能判定无依赖。'
                : '暂无 Agent 绑定该技能（基于 AgentVO.skillNames 实时计算）。'
            }}
          </div>
        </div>
      </template>
      <div v-else class="ipd-skill-bench__empty">
        未选中技能：点击左侧技能行查看 SKILL.md 预览与反向依赖。
      </div>
    </div>
  </div>
</template>

<style scoped>
.ipd-skill-bench {
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) 320px;
  padding: 12px;
}

.ipd-skill-bench__left {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow: auto;
}

.ipd-skill-bench__right {
  border-left: 1px solid var(--ipd-line);
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  padding-left: 12px;
}

.ipd-skill-bench__bar {
  align-items: center;
  display: flex;
  gap: 8px;
}

.ipd-skill-bench__meta,
.ipd-skill-bench__empty,
.ipd-skill-bench__notice {
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 20px;
}

.ipd-skill-bench__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ipd-skill-bench__cards {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
}

.ipd-skill-bench__group-head {
  align-items: baseline;
  display: flex;
  gap: 8px;
  padding: 4px 0;
}

.ipd-skill-bench__group-label {
  color: var(--ipd-text);
  font-size: 13px;
  font-weight: 600;
}

.ipd-skill-bench__row {
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 84px;
  padding: 10px;
}

.ipd-skill-bench__row:hover,
.ipd-skill-bench__row.is-preview,
.ipd-skill-bench__row:focus-visible {
  background: var(--ipd-blue-soft);
  border-color: var(--ipd-blue);
  outline: none;
}

.ipd-skill-bench__card-head {
  align-items: flex-start;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.ipd-skill-bench__name {
  color: var(--ipd-text);
  font-size: 12px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.ipd-skill-bench__desc {
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.ipd-skill-bench__panel {
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
}

.ipd-skill-bench__panel-title {
  color: var(--ipd-text);
  font-size: 13px;
  font-weight: 600;
}

.ipd-skill-bench__field {
  display: flex;
  font-size: 12px;
  gap: 8px;
  line-height: 20px;
}

.ipd-skill-bench__field-key {
  color: var(--ipd-muted);
  flex: 0 0 84px;
}

.ipd-skill-bench__field-value {
  color: var(--ipd-text);
  flex: 1;
  word-break: break-all;
}
</style>
