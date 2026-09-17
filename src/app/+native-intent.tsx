import { OAUTH_CALLBACK_PATH } from '@/hooks/use-auth';

/** On Android the OAuth redirect reaches the app as a regular deep link as
 * well as through openAuthSessionAsync(); send it to the root instead of an
 * unmatched "/auth/callback" route. The code itself is read by useAuth. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return path.includes(OAUTH_CALLBACK_PATH) ? '/' : path;
}
