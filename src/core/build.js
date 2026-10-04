/**
 * Build-time feature gates.
 *
 * Experimental UI is opt-in so release artifacts do not expose unfinished controls.
 * Vite replaces __APP_SHOW_EXPERIMENTAL__ at build time; the fallback keeps
 * source-level tests and non-Vite imports safe.
 */
export const SHOW_EXPERIMENTAL =
  typeof __APP_SHOW_EXPERIMENTAL__ !== 'undefined' ? Boolean(__APP_SHOW_EXPERIMENTAL__) : false
