/**
 * How a route answers when a database function fails.
 *
 * The stock functions (transfer_stock and the delivery functions) check their
 * own rules and RAISE EXCEPTION with a Bulgarian message the user can act on:
 * "Недостатъчна наличност…", "Същият обект…". PostgREST hands that back with
 * SQLSTATE P0001 (a plain RAISE) and the message as written. Those are the
 * caller's mistake or the stock's state, not a fault of the server: 400, and
 * the message goes to the screen unchanged.
 *
 * Anything else — a function that is missing, a bad uuid, a dropped
 * connection — is ours: 500. Its message is passed on as the routes always
 * did (the screens are admin-only and show it), with the fallback when there
 * is none.
 */

export type RpcErrorLike = { code?: string | null; message?: string | null } | null | undefined

/** SQLSTATE of a plain RAISE EXCEPTION in plpgsql. */
const RAISE_EXCEPTION = 'P0001'

/**
 * A function may raise with its own ERRCODE (check_violation and the like);
 * a Bulgarian message still means it was written for the user.
 */
const CYRILLIC = /[Ѐ-ӿ]/

export function rpcErrorResponse(
  error: RpcErrorLike,
  fallback: string,
): { status: 400 | 500; error: string } {
  const message = error?.message?.trim() || ''
  const userFacing = !!message && (error?.code === RAISE_EXCEPTION || CYRILLIC.test(message))
  return userFacing
    ? { status: 400, error: message }
    : { status: 500, error: message || fallback }
}
