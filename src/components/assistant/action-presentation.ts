import { ArrowRight, Bell, Plus, RefreshCw, type LucideIcon } from "lucide-react";
import type { AssistantAction } from "@/lib/assistant/types";

// The UI owns action vocabulary, not the model -- a label generated from
// free-form prose ("View detailed data for August 13, 2026") becomes a
// giant, wrapping button on mobile. `action.label` is still validated and
// sent by the model (kept for logging/telemetry and as a fallback), but the
// button text always comes from here: a short, predictable label per action
// type/shape, with a couple of contextual variants where it's cheap and
// genuinely useful (e.g. distinguishing "View day" from "View data").
export function assistantActionLabel(action: AssistantAction): string {
  switch (action.type) {
    case "navigate":
      switch (action.destination.page) {
        case "data":
          return action.destination.date ? "View day" : "View data";
        case "dashboard":
          return "View dashboard";
        case "activities":
          return "View activities";
      }
      break;
    case "add_activity":
      return "Add activity";
    case "set_alert":
      return "Set alert";
    case "update_alert":
      return "Update alert";
    case "disable_alert":
      return "Turn off alert";
    case "sync":
      return "Sync now";
  }
}

export function assistantActionIcon(action: AssistantAction): LucideIcon {
  switch (action.type) {
    case "navigate":
      return ArrowRight;
    case "add_activity":
      return Plus;
    case "set_alert":
    case "update_alert":
    case "disable_alert":
      return Bell;
    case "sync":
      return RefreshCw;
  }
}
