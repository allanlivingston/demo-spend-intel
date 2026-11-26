// Spend and abuse controls for the live API backend. In-memory per server instance: a demo safeguard,
// not billing. Claude Code login runs (local testing) are not metered here.
const PER_SESSION_RUNS = Number(process.env.SESSION_RUN_LIMIT ?? 50);
const DAILY_USD = Number(process.env.DAILY_SPEND_CAP_USD ?? 5);

const sessions = new Map<string, number>();
let day = "";
let spent = 0;

const today = () => new Date().toISOString().slice(0, 10);

/** Why a run can't go live, or null. An early run (started before the click) also stops once half the day's cap is spent,
 *  so runs people actually ask for never get pushed to replay by runs nobody used. */
export function checkCaps(session: string, early = false): string | null {
  if (day !== today()) { day = today(); spent = 0; sessions.clear(); }
  if ((sessions.get(session) ?? 0) >= PER_SESSION_RUNS) return "Recorded replay: demo request limit reached";
  if (spent >= DAILY_USD) return "Recorded replay: demo spend cap reached";
  if (early && spent >= DAILY_USD / 2) return "Early runs paused: half the daily cap is spent";
  return null;
}

export function record(session: string, costUsd: number) {
  sessions.set(session, (sessions.get(session) ?? 0) + 1);
  spent += costUsd;
}

export function usage() {
  return { day, spentUsd: spent, dailyCapUsd: DAILY_USD };
}
