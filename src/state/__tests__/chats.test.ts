// The sidebar chat list: switching chats never loses one, and each keeps its place.
import { expect, test } from "vitest";
import { useStore, type ChatMessage } from "@/state/store";

const say = (text: string) => useStore.getState().addMessage({ role: "user", text } as Omit<ChatMessage, "id">);
const titles = () => useStore.getState().pastChats.map((c) => c.title);

test("two chats, New chat, then open each: the list keeps both, in the same order", () => {
  const st = useStore.getState();
  st.reset();
  say("first question");
  st.newChat();
  say("second question");
  st.newChat(); // now on an empty new chat, with two saved
  expect(titles()).toEqual(["second question", "first question"]);

  const [second, first] = useStore.getState().pastChats.map((c) => c.id);
  useStore.getState().openPastChat(first);
  expect(titles()).toEqual(["second question", "first question"]);
  expect(useStore.getState().messages.map((m) => m.text)).toEqual(["first question"]);

  // Adding to an open chat updates it in place when switching away.
  say("follow-up");
  useStore.getState().openPastChat(second);
  expect(titles()).toEqual(["second question", "first question"]);
  expect(useStore.getState().pastChats[1].messages.map((m) => m.text)).toEqual(["first question", "follow-up"]);
  expect(useStore.getState().currentChatId).toBe(second);
});
