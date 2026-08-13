"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog } from "@/components/ui/dialog";
import { DropdownSelect } from "@/components/ui/dropdown-select";
import { activityFieldErrors, fetchActivityTags, saveActivity } from "@/lib/activity-client";
import { ACTIVITY_MAX_TAGS, validateActivityInput, type ActivityInput } from "@/lib/activity-utils";
import type { UsageActivity } from "@/lib/types";
import { ActivityTagChip } from "./tag-chip";
import {
  activityTagSuggestions,
  activityToday,
  defaultActivityEndTime,
  halfHourTimes,
  resolveAddTag
} from "./activity-dialog-model";

type ActivityDialogProps = {
  isOpen: boolean;
  onClose(): void;
  activity?: UsageActivity;
  defaultDate?: string;
  defaultStartTime?: string;
};

function initialForm(activity?: UsageActivity, defaultDate?: string, defaultStartTime?: string): ActivityInput {
  return activity
    ? {
        date: activity.startsAt.slice(0, 10),
        allDay: activity.allDay,
        startTime: activity.startsAt.slice(11, 16),
        endTime: activity.endsAt.slice(11, 16),
        tags: activity.tags,
        note: activity.note ?? ""
      }
    : {
        date: defaultDate ?? activityToday(),
        allDay: false,
        startTime: defaultStartTime ?? "18:00",
        endTime: defaultStartTime ? defaultActivityEndTime(defaultStartTime) : "20:30",
        tags: [],
        note: ""
      };
}

export function ActivityDialog({ isOpen, onClose, activity, defaultDate, defaultStartTime }: ActivityDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ActivityInput>(() => initialForm(activity, defaultDate, defaultStartTime));
  const [tagInput, setTagInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tagNotice, setTagNotice] = useState<string | null>(null);
  const atTagLimit = form.tags.length >= ACTIVITY_MAX_TAGS;
  const { data: tagsData } = useQuery({ queryKey: ["activity-tags"], queryFn: fetchActivityTags, enabled: isOpen });
  const suggestions = useMemo(
    () => activityTagSuggestions(tagsData?.tags ?? [], form.tags, tagInput),
    [form.tags, tagInput, tagsData?.tags]
  );
  const mutation = useMutation({
    mutationFn: (input: ActivityInput) => saveActivity(input, activity?.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["activities"] }),
        queryClient.invalidateQueries({ queryKey: ["activity-report"] }),
        queryClient.invalidateQueries({ queryKey: ["activity-tags"] })
      ]);
      onClose();
    },
    onError: (error) => setErrors(activityFieldErrors(error) ?? { form: error.message })
  });

  useEffect(() => {
    if (isOpen) {
      setForm(initialForm(activity, defaultDate, defaultStartTime));
      setTagInput("");
      setErrors({});
      setTagNotice(null);
    }
  }, [activity, defaultDate, defaultStartTime, isOpen]);

  function addTag(value: string) {
    const outcome = resolveAddTag(form.tags, value, ACTIVITY_MAX_TAGS);
    if (outcome.status === "empty") return;

    // Always clear the input on any non-empty attempt -- otherwise a
    // rejected duplicate's stale text can concatenate with whatever the
    // user types next, silently saving a garbled tag.
    setTagInput("");

    if (outcome.status === "duplicate") {
      setTagNotice("Already added.");
      return;
    }

    if (outcome.status === "limit") {
      setTagNotice(`${ACTIVITY_MAX_TAGS} tags maximum.`);
      return;
    }

    setForm((current) => ({ ...current, tags: outcome.tags }));
    setTagNotice(null);
    setErrors((current) => ({ ...current, tags: "" }));
  }

  function submit() {
    const pendingOutcome = resolveAddTag(form.tags, tagInput, ACTIVITY_MAX_TAGS);
    const submittedForm = pendingOutcome.status === "added" ? { ...form, tags: pendingOutcome.tags } : form;
    const validation = validateActivityInput(submittedForm);
    if (!validation.success) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    mutation.mutate(validation.value);
  }

  const endOptions = [...halfHourTimes.slice(1), "00:00"].map((value) => ({
    value,
    label: value === "00:00" ? "00:00 next day" : value,
    disabled: value !== "00:00" && value <= (form.startTime ?? "")
  }));

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={activity ? "Edit activity" : "Add activity"}
      description={activity ? "Update the context attached to this period." : "Add context to a day or time range."}
    >
      <form
        className="space-y-5"
        id="activity-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-ink">Date</span>
          <DatePicker
            buttonClassName="justify-between"
            fullWidth
            label="Activity date"
            onChange={(date) => setForm((current) => ({ ...current, date }))}
            value={form.date}
          />
          {errors.date ? <span className="text-xs text-red-600">{errors.date}</span> : null}
        </label>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-ink">Time</legend>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <label className="relative flex min-w-0 [&>div]:w-full">
                <span className="pointer-events-none absolute left-3 top-0 z-10 -translate-y-1/2 bg-paper px-1 text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted">
                  From
                </span>
                {form.allDay ? (
                  <span className="flex h-9 w-full items-center rounded-md border border-line bg-canvas px-3 text-sm text-muted opacity-70">
                    00:00
                  </span>
                ) : (
                  <DropdownSelect
                    ariaLabel="Activity from time"
                    className="w-full"
                    value={form.startTime ?? "18:00"}
                    options={halfHourTimes.map((value) => ({ label: value, value }))}
                    onChange={(startTime) => setForm((current) => ({ ...current, startTime }))}
                  />
                )}
              </label>
              {errors.startTime ? <span className="text-xs text-red-600">{errors.startTime}</span> : null}
            </div>
            <div className="min-w-0">
              <label className="relative flex min-w-0 [&>div]:w-full">
                <span className="pointer-events-none absolute left-3 top-0 z-10 -translate-y-1/2 bg-paper px-1 text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted">
                  To
                </span>
                {form.allDay ? (
                  <span className="flex h-9 w-full items-center rounded-md border border-line bg-canvas px-3 text-sm text-muted opacity-70">
                    23:59
                  </span>
                ) : (
                  <DropdownSelect
                    ariaLabel="Activity to time"
                    className="w-full"
                    value={form.endTime ?? "20:30"}
                    options={endOptions}
                    onChange={(endTime) => setForm((current) => ({ ...current, endTime }))}
                  />
                )}
              </label>
              {errors.endTime ? <span className="text-xs text-red-600">{errors.endTime}</span> : null}
            </div>
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm text-muted">
              <input
                checked={form.allDay}
                className="h-4 w-4 rounded border-line accent-brandTeal"
                onChange={(event) => setForm((current) => ({ ...current, allDay: event.target.checked }))}
                type="checkbox"
              />
              Whole day
            </label>
          </div>
          <p className="text-xs text-muted">
            {form.allDay ? "Applies to the full selected day." : "Choose a time range in 30-minute steps."}
          </p>
        </fieldset>

        <div className="space-y-2">
          <label className="text-sm font-medium text-ink" htmlFor="activity-tag">
            Tags
          </label>
          <div className="flex flex-wrap gap-1.5">
            {form.tags.map((tag) => (
              <ActivityTagChip
                key={tag}
                tag={tag}
                onRemove={() =>
                  setForm((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }))
                }
              />
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="h-9 min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent disabled:cursor-not-allowed disabled:bg-canvas disabled:opacity-70"
              disabled={atTagLimit}
              id="activity-tag"
              maxLength={30}
              placeholder={atTagLimit ? `${ACTIVITY_MAX_TAGS} tags maximum` : "e.g. Geyser"}
              value={tagInput}
              onChange={(event) => {
                setTagInput(event.target.value);
                setTagNotice(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(tagInput);
                }
              }}
            />
            <button
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-line bg-paper px-3 text-sm font-medium text-brandTeal transition hover:bg-accentSoft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-paper"
              disabled={atTagLimit}
              onClick={() => addTag(tagInput)}
              type="button"
            >
              <Plus className="h-4 w-4 text-accent" /> Add
            </button>
          </div>
          {tagNotice ? <p className="text-xs text-muted">{tagNotice}</p> : null}
          {atTagLimit ? <p className="text-xs text-muted">{ACTIVITY_MAX_TAGS} tags maximum.</p> : null}
          {suggestions.length && !atTagLimit ? (
            <div className="flex flex-wrap gap-1.5">
              <span className="py-1 text-xs text-muted">Suggestions:</span>
              {suggestions.map((tag) => (
                <button
                  className="rounded-md border border-line bg-paper px-2 py-1 text-xs text-muted transition hover:bg-accentSoft hover:text-brandTeal"
                  key={tag}
                  onClick={() => addTag(tag)}
                  type="button"
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
          {errors.tags ? <p className="text-xs text-red-600">{errors.tags}</p> : null}
        </div>

        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-ink">
            Note <span className="font-normal text-muted">(optional)</span>
          </span>
          <textarea
            className="min-h-24 w-full resize-y rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            maxLength={500}
            placeholder="e.g. Very cold evening, family visiting…"
            value={form.note ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          />
          <span className="flex justify-between text-xs text-muted">
            <span>{errors.note ?? ""}</span>
            <span>{form.note?.length ?? 0}/500</span>
          </span>
        </label>

        {errors.form ? <p className="text-sm text-red-600">{errors.form}</p> : null}
        <div className="flex gap-2 border-t border-line pt-4 sm:justify-end">
          <button
            className="h-10 flex-1 rounded-md border border-line px-4 text-sm text-muted transition hover:bg-canvas hover:text-ink sm:flex-none"
            disabled={mutation.isPending}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 flex-1 rounded-md bg-brandTeal px-5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
            disabled={mutation.isPending}
            type="submit"
          >
            {mutation.isPending ? "Saving..." : "Save activity"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
