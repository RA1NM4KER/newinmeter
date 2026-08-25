import { ArrowRight, Bell, Calendar, Pencil, Plus, RefreshCw, Trash2, type LucideIcon } from "lucide-react";
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
        // "View day" is owned by open_day_detail now (opens the shared Day
        // Detail dialog in place); this is only ever an explicit request
        // for the raw /data table/export view, so it gets its own label.
        case "data":
          return action.destination.date ? "View raw data" : "View data";
        case "dashboard":
          return "View dashboard";
        case "activities":
          return "View activities";
      }
      break;
    case "open_day_detail":
      return "View day";
    case "add_activity":
      return "Add activity";
    case "update_activity":
      return "Update activity";
    case "delete_activity":
      return "Delete activity";
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
    case "open_day_detail":
      return Calendar;
    case "add_activity":
      return Plus;
    case "update_activity":
      return Pencil;
    case "delete_activity":
      return Trash2;
    case "set_alert":
    case "update_alert":
    case "disable_alert":
      return Bell;
    case "sync":
      return RefreshCw;
  }
}
