"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser, savePrefs } from "@/lib/auth";
import {
  editLayout,
  isBlock,
  isLayoutEdit,
  parsePrefs,
  serializePrefs,
} from "@/lib/prefs";

/**
 * A layout change made on the profile itself: hide, show, move, or resize one
 * section.
 *
 * Always the signed-in person's own layout, whatever page the form sat on;
 * there is no user id in the form to tamper with. A plain form post, so it
 * works before the page's JavaScript has loaded.
 */
export async function changeLayout(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const edit = formData.get("edit");
  const block = formData.get("block");
  if (isLayoutEdit(edit) && isBlock(block)) {
    const next = editLayout(parsePrefs(user.prefs), edit, block);
    await savePrefs(user.id, serializePrefs(next));
  }

  // Back to the page the button was on, still customising. Only the owner's
  // own pages, so the field cannot send anyone elsewhere.
  const back = String(formData.get("back") ?? "");
  const target =
    back === "/account" || back === `/profile/${user.handle}` ? back : "/account";
  revalidatePath(target);
  redirect(`${target}?customise=1#${block ?? ""}`);
}
