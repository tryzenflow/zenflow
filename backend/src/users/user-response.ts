import type { Lang, User as UserView } from "@zenflow/shared";
import type { Language, User } from "../../generated/prisma";

const TO_WIRE: Record<Language, Lang> = { VI_VN: "vi", EN_US: "en" };
const TO_DB: Record<Lang, Language> = { vi: "VI_VN", en: "EN_US" };

export const langToDb = (lang: Lang): Language => TO_DB[lang];

/** The user as sent to clients: `lang` is the wire form ("vi" | "en"). */
export function toUserResponse(user: User) {
  return { ...user, lang: TO_WIRE[user.lang] } as Omit<User, "lang"> &
    Pick<UserView, "lang">;
}
