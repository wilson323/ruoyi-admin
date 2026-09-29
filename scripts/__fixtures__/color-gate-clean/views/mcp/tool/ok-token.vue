<template>
  <button class="btn">OK</button>
</template>
<style scoped>
/* token 合法用法：var(--x) 与 rgb(var(--x)) 均放行 */
.btn {
  color: var(--ipd-blue);
  border-color: rgb(var(--ipd-blue));
}
</style>
