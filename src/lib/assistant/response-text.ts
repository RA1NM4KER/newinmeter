import type { AssistantResponse } from "./types";

// Flattens the structured response into plain text for the ONE place that
// still needs it: the conversation-history payload sent back to the model
// on a follow-up turn (see assistant-provider.tsx). The UI itself never
// renders this string -- it renders headline/metrics/body directly (see
// assistant-message.tsx) -- so this only has to be faithful enough for the
// model to recall its own prior turn, not pretty.
export function flattenAssistantResponseText(response: Pick<AssistantResponse, "headline" | "body">): string {
  const parts = [response.headline];
  for (const block of response.body) {
    parts.push(block.heading ? `${block.heading}: ${block.text}` : block.text);
  }
  return parts.join(" ");
}
