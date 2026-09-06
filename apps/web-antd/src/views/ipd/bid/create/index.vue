<template>
  <div class="mx-auto max-w-[760px] p-4">
    <Card>
      <template #title>发起招标</template>
      <Alert
        class="mb-4"
        message="招标单创建后立即进入「招标中」状态（后端无草稿态），有效期截止前研发PM 可提交应标。"
        type="info"
        show-icon
      />
      <Alert
        v-if="!isMarketSide"
        class="mb-4"
        message="发起招标通常由市场PM 操作，当前角色提交后仍以服务端权限校验结果为准。"
        type="info"
        show-icon
      />

      <!-- 拒绝态 / 断网态 -->
      <Alert
        v-if="submitError"
        class="mb-4"
        :message="submitError"
        type="error"
        show-icon
        role="alert"
      />

      <Form layout="vertical">
        <Form.Item
          label="招标标题"
          required
          :validate-status="errors.title ? 'error' : ''"
          :help="errors.title"
        >
          <Input
            v-model:value="form.title"
            :maxlength="120"
            show-count
            placeholder="请输入招标标题（不少于 4 字）"
            :disabled="submitting"
          />
        </Form.Item>

        <Form.Item
          label="招标内容"
          required
          :validate-status="errors.content ? 'error' : ''"
          :help="errors.content"
        >
          <Textarea
            v-model:value="form.content"
            :rows="8"
            :maxlength="4000"
            show-count
            placeholder="ZK-IPD 设计稿要求按以下 7 段结构书写（产品类型 / 目标上市 / 市场窗口 / 战略等级 / 客户问题 / 应用场景 / 核心功能）。建议至少包含：①产品类型（软硬件融合/纯软件/硬件） ②目标上市日期 ③市场窗口（如 2027-Q2） ④战略等级（S/A/B） ⑤客户问题（谁在什么场景遇到什么问题） ⑥应用场景（典型使用环境） ⑦核心功能（必备能力清单）。"
            :disabled="submitting"
          />
        </Form.Item>

        <Form.Item label="招标方式" required>
          <Radio.Group v-model:value="form.mode" :disabled="submitting">
            <Radio value="ONE_TO_ONE">定向邀请</Radio>
            <Radio value="PUBLIC">公开征集</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          v-if="form.mode === 'ONE_TO_ONE'"
          label="指定研发PM ID"
          required
          :validate-status="errors.targetPersonId ? 'error' : ''"
          :help="errors.targetPersonId"
        >
          <Input
            v-model:value="form.targetPersonId"
            :maxlength="24"
            placeholder="请输入受邀研发PM 的人员 ID（纯数字）"
            :disabled="submitting"
          />
          <p class="text-muted-foreground mt-1 text-xs">
            系统暂未提供研发PM 花名册查询，请向受邀研发PM 获取其人员 ID 后填入。
          </p>
        </Form.Item>

        <Form.Item
          label="有效期截止"
          required
          :validate-status="errors.expireAt ? 'error' : ''"
          :help="errors.expireAt"
        >
          <DatePicker
            v-model:value="form.expireAt"
            show-time
            value-format="YYYY-MM-DD HH:mm:ss"
            format="YYYY-MM-DD HH:mm:ss"
            placeholder="请选择有效期截止时间"
            :disabled="submitting"
          />
          <p class="text-muted-foreground mt-1 text-xs">默认为 7 天后，到期无人应标的招标单将由系统自动置为「已过期」。</p>
        </Form.Item>

        <div class="flex justify-end gap-2">
          <Button :disabled="submitting" @click="goBack">取消</Button>
          <Button type="primary" :loading="submitting" @click="submit">提交创建</Button>
        </div>
      </Form>
    </Card>
  </div>
</template>

<script setup lang="ts">
// 页20 发起招标（看板卡 P0-10.20；后端 POST /bid-invitations 已交付，创建即 OPEN）。
// 字段以后端 BidInvitation 实体真值为准：title / content / mode / targetPersonId / expireAt。
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Alert, Button, Card, DatePicker, Form, Input, Radio, message } from 'ant-design-vue';
import { createBidInvitation } from '../../../../api/ipd/bid';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { bidErrorText } from '../bid-error';
import '../../_shared/ipd-theme.css';

const router = useRouter();
const auth = useIpdAuthStore();

const Textarea = Input.TextArea;
const isMarketSide = computed(() => ['MARKET_PM', 'SUPER_ADMIN'].includes(auth.identity?.person.personType ?? ''));

const submitting = ref(false);
const submitError = ref('');

const form = reactive({
  content: '',
  expireAt: '',
  mode: 'ONE_TO_ONE' as 'ONE_TO_ONE' | 'PUBLIC',
  targetPersonId: '',
  title: '',
});

const errors = reactive({
  content: '',
  expireAt: '',
  targetPersonId: '',
  title: '',
});

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** BR-REC-CREATE-03：有效期截止默认 7 天后（当日 23:59:59）。 */
function defaultExpireAt(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 23:59:59`;
}

function validate(): boolean {
  errors.title = '';
  errors.content = '';
  errors.targetPersonId = '';
  errors.expireAt = '';
  const title = form.title.trim();
  if (title.length < 4) errors.title = '招标标题不少于 4 字';
  const content = form.content.trim();
  if (content.length < 4) errors.content = '招标内容不少于 4 字';
  if (content.length > 4000) errors.content = '招标内容不超过 4000 字';
  if (form.mode === 'ONE_TO_ONE' && !/^\d+$/.test(form.targetPersonId.trim())) {
    errors.targetPersonId = '定向邀请须填写受邀研发PM 的人员 ID（纯数字）';
  }
  if (!form.expireAt) {
    errors.expireAt = '请选择有效期截止时间';
  } else if (new Date(form.expireAt.replace(' ', 'T')).getTime() <= Date.now()) {
    errors.expireAt = '有效期截止须晚于当前时间';
  }
  return !errors.title && !errors.content && !errors.targetPersonId && !errors.expireAt;
}

function goBack(): void {
  router.push('/ipd/bids');
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (!validate()) return;
  submitting.value = true;
  submitError.value = '';
  try {
    await createBidInvitation({
      content: form.content.trim(),
      expireAt: form.expireAt,
      mode: form.mode,
      targetPersonId: form.mode === 'ONE_TO_ONE' ? form.targetPersonId.trim() : null,
      title: form.title.trim(),
    });
    message.success('招标单已创建，当前状态：招标中');
    router.push('/ipd/bids');
  } catch (cause) {
    submitError.value = bidErrorText(cause, {
      fallback: '创建失败，请稍后重试',
      codeTexts: { 10001: '输入信息不符合要求，请检查各字段后重试', 30001: '当前账号无权发起招标，请联系管理员' },
    });
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  form.expireAt = defaultExpireAt();
});
</script>
