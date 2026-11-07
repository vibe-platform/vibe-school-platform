type UserNameFields = {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
};

export function displayUserName(user: UserNameFields) {
  return user.displayName?.trim()
    || [user.firstName, user.lastName].filter((value): value is string => Boolean(value?.trim())).join(" ")
    || user.username?.trim()
    || "Пользователь";
}
