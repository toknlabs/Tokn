import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { currentUser } from "@/lib/auth";
import { githubEnabled, safeReturnPath } from "@/lib/backend";

export const dynamic = "force-dynamic";

/** The welcome flow, carrying where to go once it is done. */
function welcomePath(next: string | null): string {
  return next ? `/welcome?next=${encodeURIComponent(next)}` : "/welcome";
}

export const metadata: Metadata = { title: "sign in — tokn" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // Only same-site paths, so `?next=` cannot be used as an open redirect.
  // `safeReturnPath` also catches the spellings a prefix check lets through.
  const requested = safeReturnPath(next);

  const user = await currentUser();
  if (user) redirect(requested ?? "/account");

  return (
    <AuthForm
      next={requested ?? "/account"}
      // A new account always gets the welcome flow. Someone who was sent here
      // from somewhere (an app's sign-in, say) goes back to it at the end.
      afterSignup={welcomePath(requested)}
      github={githubEnabled()}
      initialError={error ? error.slice(0, 200) : null}
    />
  );
}
