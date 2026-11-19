import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileView } from "@/components/ProfileView";
import { currentUser, findUserByHandle } from "@/lib/auth";
import { areFriends } from "@/lib/backend";
import { rankOf } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  return { title: `${handle} — tokn` };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ customise?: string }>;
}) {
  const { handle } = await params;
  const { customise } = await searchParams;
  const user = await findUserByHandle(decodeURIComponent(handle));
  if (!user) notFound();

  // A private profile is a 404 to everyone but its owner. Not a "this is
  // private" page: that would confirm the handle exists, which is exactly what
  // making it private was meant to stop.
  const me = await currentUser();
  const own = me?.id === user.id;

  // A private profile is visible to accepted friends. That is the whole point
  // of the accept step: following would let anyone watch, where friendship is
  // something both sides agreed to.
  const friend = !own && me ? await areFriends(me.id, user.id) : false;
  if (!user.isPublic && !own && !friend) notFound();

  return (
    <ProfileView
      user={{
        id: user.id,
        handle: user.handle,
        name: user.name,
        bio: user.bio,
        createdAt: user.created_at,
        billing: user.billing,
        links: user.links,
        prefs: user.prefs ?? null,
        plans: user.plans ?? null,
        avatarUrl: user.avatarUrl ?? null,
        isPublic: user.isPublic,
        listed: user.listed,
      }}
      rank={user.listed ? await rankOf(user.id, "all", "cost") : null}
      own={own}
      customise={own && customise === "1"}
      back={`/profile/${user.handle}`}
    />
  );
}
