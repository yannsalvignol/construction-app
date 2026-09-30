/**
 * What the screen tells the worker about the watch.
 *
 * The decision itself is no longer made here. It used to be: each background fix
 * fed a timer in this file, and the timer raised the alert. That could never have
 * worked — iOS delivers background location on distance, not on time, so a phone
 * that stops moving stops emitting fixes and the timer meant to notice he had
 * stopped moving never ran again. The server holds the deadline now, and treats
 * silence as the signal. These constants only have to agree with
 * `lone_worker_still_for()` and `lone_worker_answer_window()` in the migration.
 */

/** No movement for this long during a declared day raises the question. */
export const STILL_FOR_MS = 25 * 60_000;
/** How long he has to answer before the alert goes out. */
export const ANSWER_WINDOW_MS = 3 * 60_000;
