<script setup lang="ts">
/**
 * 项目详情-协作圈 Tab（看板卡 c5254e23；原型 项目空间-协作圈）。
 *
 * 数据源唯一：ProjectCircleController /api/v1/project-circle 6 端点
 * （视图 / 加协作人候选 / 加协作人 / 发动态 / 评论 / 成员透传）。
 * 五态：加载 / 错误重试 / 成员与动态空态 / 正常 / 只读（ARCHIVED 项目readOnly 横幅）。
 * 写操作可见性：添加协作人仅 canManage（后端 candidates/members 写端点双重校验），
 * 发动态/评论全员可写（OPERATION_MODULE_PROJECT），后端拒绝时原样透出错误文案。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Textarea,
  message,
} from 'ant-design-vue';

import { formatDate } from '../../_shared/format';
import { ipdApiErrorText } from '../../../../api/ipd/ai-document';
import {
  type CircleCandidate,
  type CircleComment,
  type CircleMember,
  type CirclePost,
  type CircleRole,
  type CircleView,
  addCircleMember,
  createCircleComment,
  createCirclePost,
  listCircleCandidates,
  viewCircle,
} from '../../../../api/ipd/project-circle';

const CIRCLE_ROLE_TEXTS: Record<string, string> = {
  COMMENTER: '评论者',
  CONTRIBUTOR: '贡献者',
  FOLLOWER: '关注者',
};

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));

const loading = ref(false);
const loadError = ref<null | string>(null);
const view = ref<null | CircleView>(null);

const members = computed<CircleMember[]>(() => view.value?.members ?? []);
const posts = computed<CirclePost[]>(() => view.value?.posts ?? []);
const canManage = computed(() => view.value?.canManage === true);
const readOnly = computed(() => view.value?.readOnly === true);

/** 发动态（2-3000 字，与后端校验一致）。 */
const postDraft = ref('');
const posting = ref(false);

/** 评论草稿与回复目标：按动态 ID 分桶；replyTo 记录楼中楼父评论。 */
const commentDrafts = reactive<Record<string, string>>({});
const commentBusy = reactive<Record<string, boolean>>({});
const replyTo = reactive<Record<string, null | CircleComment>>({});

/** 添加协作人弹窗。 */
const addOpen = ref(false);
const addLoading = ref(false);
const candidates = ref<CircleCandidate[]>([]);
const pickedUserId = ref<string | undefined>();
const pickedRole = ref<CircleRole | undefined>();
const adding = ref(false);

async function loadView() {
  loading.value = true;
  loadError.value = null;
  try {
    view.value = await viewCircle(projectId.value);
  } catch (cause) {
    view.value = null;
    loadError.value = ipdApiErrorText(cause, '协作圈加载失败，请稍后重试');
  } finally {
    loading.value = false;
  }
}

async function submitPost() {
  const content = postDraft.value.trim();
  if (content.length < 2 || content.length > 3000) {
    message.warning('动态内容需在 2-3000 字之间');
    return;
  }
  posting.value = true;
  try {
    await createCirclePost(projectId.value, content);
    postDraft.value = '';
    message.success('动态已发布');
    await loadView();
  } catch (cause) {
    message.error(ipdApiErrorText(cause, '动态发布失败，请稍后重试'));
  } finally {
    posting.value = false;
  }
}

async function submitComment(post: CirclePost) {
  const content = (commentDrafts[post.id] ?? '').trim();
  if (content.length < 2 || content.length > 2000) {
    message.warning('评论内容需在 2-2000 字之间');
    return;
  }
  const parent = replyTo[post.id] ?? null;
  commentBusy[post.id] = true;
  try {
    await createCircleComment(post.id, content, parent?.id ?? undefined);
    commentDrafts[post.id] = '';
    replyTo[post.id] = null;
    message.success('评论已发布');
    await loadView();
  } catch (cause) {
    message.error(ipdApiErrorText(cause, '评论发布失败，请稍后重试'));
  } finally {
    commentBusy[post.id] = false;
  }
}

async function openAddModal() {
  addOpen.value = true;
  addLoading.value = true;
  pickedUserId.value = undefined;
  pickedRole.value = undefined;
  try {
    candidates.value = await listCircleCandidates(projectId.value);
  } catch (cause) {
    candidates.value = [];
    message.error(ipdApiErrorText(cause, '候选人加载失败，请稍后重试'));
  } finally {
    addLoading.value = false;
  }
}

async function submitAdd() {
  if (!pickedUserId.value) {
    message.warning('请选择要添加的协作人');
    return;
  }
  adding.value = true;
  try {
    await addCircleMember(projectId.value, pickedUserId.value, pickedRole.value);
    addOpen.value = false;
    message.success('协作人已加入');
    await loadView();
  } catch (cause) {
    message.error(ipdApiErrorText(cause, '添加协作人失败，请稍后重试'));
  } finally {
    adding.value = false;
  }
}

onMounted(() => {
  if (projectId.value) void loadView();
});
</script>

<template>
  <div class="p-4">
    <template v-if="loading">
      <div class="flex min-h-[240px] items-center justify-center">
        <Spin size="large" tip="正在加载协作圈……" />
      </div>
    </template>

    <template v-else-if="loadError">
      <Alert show-icon type="error">
        <template #message>
          {{ loadError }}
          <Button size="small" type="link" @click="loadView">重试</Button>
        </template>
      </Alert>
    </template>

    <template v-else-if="view">
      <Alert
        v-if="readOnly"
        class="mb-3"
        message="项目已归档，协作圈进入只读模式，不再接受新动态与评论。"
        show-icon
        type="warning"
      />

      <Card class="mb-4" title="协作成员">
        <template #extra>
          <Button v-if="canManage && !readOnly" size="small" type="primary" @click="openAddModal">
            添加协作人
          </Button>
        </template>
        <Empty v-if="members.length === 0" description="暂无协作成员" />
        <Space v-else wrap>
          <Tag v-for="m in members" :key="m.userId" class="!py-1 !px-2">
            <Avatar :size="18" class="!mr-1 !align-middle">
              {{ (m.name ?? '?').slice(0, 1) }}
            </Avatar>
            {{ m.name ?? `用户 ${m.userId}` }}
            <small class="text-gray-400">
              {{ CIRCLE_ROLE_TEXTS[m.circleRole ?? 'FOLLOWER'] ?? m.circleRole }}
            </small>
          </Tag>
        </Space>
      </Card>

      <Card title="项目动态">
        <template #extra>
          <small class="text-gray-400">共 {{ posts.length }} 条</small>
        </template>

        <div v-if="!readOnly" class="mb-4">
          <Textarea
            v-model:value="postDraft"
            :maxlength="3000"
            :rows="3"
            placeholder="同步进展、提出问题（2-3000 字）……"
          />
          <div class="mt-2 text-right">
            <Button
              :disabled="postDraft.trim().length < 2"
              :loading="posting"
              type="primary"
              @click="submitPost"
            >
              发布动态
            </Button>
          </div>
        </div>

        <Empty v-if="posts.length === 0" description="暂无动态，发布第一条进展吧" />
        <div v-else class="flex flex-col gap-4">
          <div v-for="post in posts" :key="post.id" class="rounded border border-gray-100 p-3">
            <div class="mb-1 flex items-center gap-2">
              <Avatar :size="24">{{ (post.authorName ?? '?').slice(0, 1) }}</Avatar>
              <strong>{{ post.authorName ?? `用户 ${post.authorId}` }}</strong>
              <small class="text-gray-400">{{ formatDate(post.createdAt) || '—' }}</small>
              <Tag v-if="post.objectType" class="!ml-auto">{{ post.objectType }} #{{ post.objectId }}</Tag>
            </div>
            <p class="mb-2 whitespace-pre-wrap">{{ post.content }}</p>

            <div v-if="post.comments.length > 0" class="mb-2 ml-8 flex flex-col gap-1 border-l-2 border-gray-100 pl-3">
              <div v-for="c in post.comments" :key="c.id" class="text-sm">
                <template v-if="c.parentId">
                  <span class="text-gray-400">↳ 回复 </span>
                  <strong>{{ post.comments.find((p) => p.id === c.parentId)?.authorName ?? '' }}</strong>
                 ：
                </template>
                <strong>{{ c.authorName ?? `用户 ${c.authorId}` }}</strong>
                ：{{ c.content }}
                <small v-if="!readOnly" class="ml-1 cursor-pointer text-blue-500" @click="replyTo[post.id] = c">
                  回复
                </small>
              </div>
            </div>

            <div v-if="!readOnly" class="flex items-center gap-2">
              <Input
                v-model:value="commentDrafts[post.id]"
                :placeholder="
                  replyTo[post.id]
                    ? `回复 @${replyTo[post.id]!.authorName ?? ''}（2-2000 字）……`
                    : '写下评论（2-2000 字）……'
                "
                size="small"
                @press-enter="submitComment(post)"
              />
              <Button
                :disabled="(commentDrafts[post.id] ?? '').trim().length < 2"
                :loading="commentBusy[post.id] === true"
                size="small"
                @click="submitComment(post)"
              >
                评论
              </Button>
              <a
                v-if="replyTo[post.id]"
                class="cursor-pointer text-xs text-gray-400"
                @click="replyTo[post.id] = null"
              >
                取消回复
              </a>
            </div>
          </div>
        </div>
      </Card>
    </template>

    <Modal
      v-model:open="addOpen"
      :confirm-loading="adding"
      ok-text="加入"
      title="添加协作人"
      @ok="submitAdd"
    >
      <Spin :spinning="addLoading">
        <div class="flex flex-col gap-3 py-2">
          <Select
            v-model:value="pickedUserId"
            :options="
              candidates.map((c) => ({
                label: `${c.name ?? `用户 ${c.id}`}（${c.personType ?? '未知角色'}）`,
                value: c.id,
              }))
            "
            placeholder="选择在职且未入圈的成员"
            show-search
          />
          <Select
            v-model:value="pickedRole"
            :options="[
              { label: '关注者（默认）', value: 'FOLLOWER' },
              { label: '评论者', value: 'COMMENTER' },
              { label: '贡献者', value: 'CONTRIBUTOR' },
            ]"
            placeholder="圈角色（默认关注者）"
          />
          <p class="m-0 text-xs text-gray-400">
            候选人来自在职人员目录且未加入本项目协作圈；加入后立即生效并通知本人。
          </p>
        </div>
      </Spin>
    </Modal>
  </div>
</template>
