import type { Device } from "../repo/devices.ts";
import type { Profile } from "../repo/profiles.ts";
import type { OAuthClient } from "./clients.ts";
import { oauthAppForDevice } from "./devices.ts";

/**
 * Who has signed in to an app with tokn, one row per person, for the owner
 * pages.
 *
 * Each sign-in is a device row (see devices.ts). Someone who signed in on two
 * computers, or signed out and back in, has several; this folds them into one
 * person, linked while any of those sign-ins is still live. Revoking one on
 * the account page, or signing out in the app, is what ends it.
 */

export interface AppSignIn {
  userId: string;
  /** Null for a profile that is gone: deleting an account removes its devices too, so only one caught mid-deletion. */
  handle: string | null;
  name: string | null;
  /** At least one of their sign-ins is still live. */
  linked: boolean;
  firstLinkedAt: string;
  lastLinkedAt: string;
  /** When their last live sign-in was revoked. Null while linked. */
  unlinkedAt: string | null;
  lastSyncAt: string | null;
  /** The app's version, as the sign-in that last synced reported it. */
  version: string | null;
  /** The computers they are linked on now, by name. */
  computers: string[];
  /** Every sign-in they have made, live or not. */
  signIns: number;
}

const time = (iso: string | null | undefined): number => {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
};

const newest = (values: (string | null | undefined)[]): string | null =>
  values.reduce<string | null>((best, value) => (value && time(value) > time(best) ? value : best), null);

/** The device rows that really are this app's sign-ins: the id shape and the version prefix, as the account page checks. */
export function signInsOf(client: OAuthClient, devices: readonly Device[]): Device[] {
  return devices.filter((device) => oauthAppForDevice(device.$id, device.cliVersion)?.client.id === client.id);
}

/** When this person last did anything with the app: signed in, synced, or signed out. */
export function lastSeen(row: AppSignIn): string {
  return newest([row.lastLinkedAt, row.lastSyncAt, row.unlinkedAt]) ?? row.lastLinkedAt;
}

/** One row per person who has signed in to `client`, most recently active first. */
export function appSignIns(
  client: OAuthClient,
  devices: readonly Device[],
  profiles: readonly Profile[],
): AppSignIn[] {
  const profileById = new Map(profiles.map((profile) => [profile.$id, profile]));
  const byUser = new Map<string, Device[]>();
  for (const device of signInsOf(client, devices)) {
    byUser.set(device.userId, [...(byUser.get(device.userId) ?? []), device]);
  }

  const rows: AppSignIn[] = [];
  for (const [userId, own] of byUser) {
    const live = own.filter((device) => !device.revokedAt);
    const profile = profileById.get(userId);
    const lastSynced = [...own].sort(
      (a, b) => time(b.lastSyncAt ?? b.linkedAt) - time(a.lastSyncAt ?? a.linkedAt),
    )[0]!;
    const linkedAts = own.map((device) => device.linkedAt).sort((a, b) => time(a) - time(b));

    rows.push({
      userId,
      handle: profile?.handle ?? null,
      name: profile?.name?.trim() || null,
      linked: live.length > 0,
      firstLinkedAt: linkedAts[0]!,
      lastLinkedAt: linkedAts[linkedAts.length - 1]!,
      unlinkedAt: live.length > 0 ? null : newest(own.map((device) => device.revokedAt)),
      lastSyncAt: newest(own.map((device) => device.lastSyncAt)),
      version: oauthAppForDevice(lastSynced.$id, lastSynced.cliVersion)?.version ?? null,
      // An app that sent no computer name was recorded under its own name.
      computers: [
        ...new Set(
          live
            .map((device) => device.hostname)
            .filter((name): name is string => Boolean(name) && name !== client.name),
        ),
      ],
      signIns: own.length,
    });
  }

  return rows.sort((a, b) => time(lastSeen(b)) - time(lastSeen(a)));
}
