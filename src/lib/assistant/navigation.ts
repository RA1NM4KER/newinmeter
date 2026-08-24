import type { AssistantNavigateDestination } from "./types";

// The only place an AssistantAction's typed destination becomes a real URL.
// Every field is app-owned (date/from/to strings the model filled into a
// closed shape, never a raw path or href) -- there is no branch here that
// can produce anything other than one of these three known routes.
export function resolveAssistantDestination(destination: AssistantNavigateDestination): string {
  switch (destination.page) {
    case "dashboard": {
      const params = new URLSearchParams();
      if (destination.from) params.set("from", destination.from);
      if (destination.to) params.set("to", destination.to);
      const query = params.toString();
      return query ? `/?${query}` : "/";
    }
    case "data": {
      // /data's own filter (useDataTableUrlState) reads the same from/to
      // query keys as the dashboard -- there's no separate single-day
      // param, so a single date just becomes a same-day from/to range.
      const params = new URLSearchParams();
      const from = destination.date ?? destination.from;
      const to = destination.date ?? destination.to;
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const query = params.toString();
      return query ? `/data?${query}` : "/data";
    }
    case "activities": {
      // Activities' dashboard tab reads the same from/to range filter as
      // the main dashboard (useFilterUrlState) -- a single date becomes a
      // same-day range, same convention as the /data case above.
      const params = new URLSearchParams();
      if (destination.date) {
        params.set("from", destination.date);
        params.set("to", destination.date);
      }
      const query = params.toString();
      return query ? `/activities?${query}` : "/activities";
    }
  }
}
