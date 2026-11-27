// An older draft stops being "waiting" once a newer draft of the same kind arrives, approved or not, so its chips go.
import { expect, test } from "vitest";
import { pendingDraft } from "@/state/chipRules";
import type { ChatMessage } from "@/state/store";

const draft = (id: string, status: "proposed" | "applied") =>
  ({ id, role: "assistant", artifact: { kind: "policy_diff", id: `art-${id}`, rows: [] }, artifactStatus: status }) as unknown as ChatMessage;

test("an older proposed draft is not pending once a newer one was applied", () => {
  expect(pendingDraft([draft("a", "proposed"), draft("b", "applied")])).toBeNull();
});

test("the newest proposed draft is pending", () => {
  expect(pendingDraft([draft("a", "applied"), draft("b", "proposed")])?.id).toBe("b");
});
