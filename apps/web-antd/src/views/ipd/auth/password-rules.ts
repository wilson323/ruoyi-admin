export function validateNewPassword(currentPassword: string, newPassword: string, confirmation: string): string {
  if (!currentPassword) return '请输入当前密码';
  if (newPassword.length < 8) return '新密码至少需要8个字符';
  if (new TextEncoder().encode(newPassword).length > 72) return '新密码的UTF-8编码不能超过72字节';
  if (newPassword === currentPassword) return '新密码不能与当前密码相同';
  if (newPassword !== confirmation) return '两次输入的新密码不一致';
  return '';
}

export function passwordStrength(password: string): { label: string; score: number } {
  const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^\da-z]/i].filter((pattern) => pattern.test(password)).length;
  const score = password.length < 8 ? Math.min(25, password.length * 3) : Math.min(100, groups * 20 + (password.length >= 12 ? 20 : 0));
  return { label: score < 40 ? '弱' : score < 80 ? '中' : '强', score };
}
