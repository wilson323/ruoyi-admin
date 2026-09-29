import type { PageResult } from '#/api/common';
import type { Ref } from 'vue';

import { onMounted, ref } from 'vue';

/** Shared pagination for the card view; the existing table remains available. */
export function useCatalogCards<T>(
  loadPage: (page: number, size: number) => Promise<PageResult<T>>,
) {
  const rows = ref<T[]>([]) as Ref<T[]>;
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(12);
  const loading = ref(false);
  const error = ref(false);
  let requestId = 0;

  async function refresh() {
    const current = ++requestId;
    loading.value = true;
    error.value = false;
    try {
      const result = await loadPage(page.value, pageSize.value);
      if (current !== requestId) return;
      if (
        result.total > 0 &&
        page.value > Math.ceil(result.total / pageSize.value)
      ) {
        page.value = Math.ceil(result.total / pageSize.value);
        await refresh();
        return;
      }
      rows.value = result.rows;
      total.value = result.total;
    } catch {
      if (current !== requestId) return;
      rows.value = [];
      total.value = 0;
      error.value = true;
    } finally {
      if (current === requestId) loading.value = false;
    }
  }

  async function search() {
    page.value = 1;
    await refresh();
  }

  async function changePage(next: number, size: number) {
    page.value = next;
    pageSize.value = size;
    await refresh();
  }

  onMounted(() => {
    void refresh();
  });
  return {
    rows,
    total,
    page,
    pageSize,
    loading,
    error,
    refresh,
    search,
    changePage,
  };
}
