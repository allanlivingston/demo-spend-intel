export const dynamic = "force-dynamic";

export default async function Unlock({ searchParams }: { searchParams: Promise<{ wrong?: string; passcode?: string }> }) {
  const { wrong, passcode } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#faf9f5] px-4">
      <form method="POST" action="/api/unlock" className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="font-serif text-[26px] font-light">Spend Intelligence</h1>
        <p className="text-[14px] text-neutral-600">Enter the passcode to open the demo.</p>
        <input name="passcode" type="password" autoFocus required autoComplete="current-password" aria-label="Passcode" defaultValue={passcode ?? ""}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-[15px]" />
        {wrong && <p className="text-[13px] text-bad">That passcode didn&apos;t match. Try again.</p>}
        <button type="submit" className="w-full rounded-lg bg-ink px-4 py-2 text-[15px] font-medium text-white hover:bg-neutral-800">Open</button>
      </form>
    </main>
  );
}
