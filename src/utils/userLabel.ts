/** Username-or-ID label, used for the admin who acted on something. */
export function adminLabel(admin: { id: number; username?: string | null } | null, fallbackId: number): string {
  if (admin?.username) return `@${admin.username}`;
  return `ID ${admin?.id ?? fallbackId}`;
}

/** Username-or-full-name-or-ID label, used for a target/applicant user. */
export function describeUser(
  user: { telegramId: number; username?: string | null; firstName?: string | null; lastName?: string | null } | null,
  fallbackId?: number,
): string {
  if (user?.username) return `@${user.username}`;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  return name || `ID ${fallbackId ?? user?.telegramId}`;
}
