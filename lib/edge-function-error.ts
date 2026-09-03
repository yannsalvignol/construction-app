import { FunctionsHttpError } from '@supabase/supabase-js';

/**
 * supabase.functions.invoke() only ever puts the parsed JSON body on `data`
 * for a 2xx response. When an Edge Function returns a non-2xx status (the
 * "{ error: '...' }" responses create-employee/reset-employee-password send
 * on failure), `data` is null and `error` is a FunctionsHttpError whose
 * `.message` is just the generic "Edge Function returned a non-2xx status
 * code" — the actual reason is on `error.context`, a raw Response that has
 * to be read separately. Reading `data?.error` on failure (the previous
 * pattern here) always came up empty, so the UI could only ever show that
 * generic fallback and swallowed the real error.
 */
export async function resolveFunctionError(
  functionName: string,
  error: unknown
): Promise<string | null> {
  if (!error) return null;

  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      console.error(`[${functionName}] edge function returned an error:`, body);
      return body?.error ?? error.message;
    } catch (parseError) {
      console.error(`[${functionName}] edge function error body was not JSON:`, parseError);
      return error.message;
    }
  }

  console.error(`[${functionName}] edge function invoke failed:`, error);
  return error instanceof Error ? error.message : 'Unknown error';
}
