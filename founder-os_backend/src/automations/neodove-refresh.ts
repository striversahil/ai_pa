/**
 * neodove-refresh.ts — server-side NeoDove USER_REPORT refresh.
 *
 * Port of scripts/neodove-report-runner.js (--today mode). Runs inside the
 * Worker because GitHub Actions egress IPs are blocked by connect.neodove.com
 * (the 10-min GH workflow failed ~90% of runs; local/Cloudflare egress works).
 *
 * Fetches the call-log-report for TODAY (IST), keeps only rows whose own
 * date matches the requested IST day (the API ignores range params and
 * returns rows spanning neighbouring days), normalizes them, and overwrites
 * the D1 Setting key `neodove_user_report:<YYYY-MM-DD>`.
 */


// Pieces split into ./neodove-refresh-parts/ (importable on their own); re-exported for compat.
export { istDateStr } from "./neodove-refresh-parts/pure";
export { probeNeodoveDirectory, refreshNeodoveReport } from "./neodove-refresh-parts/io";


