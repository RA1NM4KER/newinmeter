import type { ReactNode } from "react";

export type CardProps = {
  children: ReactNode;
  className?: string;
};

export type CardHeaderProps = {
  title: string;
  action?: ReactNode;
};

export type MetricCardProps = {
  label: ReactNode;
  value: string;
  detail?: string;
  description?: string;
  tone?: "neutral" | "good" | "watch" | "danger";
  comparison?: {
    text: string;
    tone: "good" | "watch" | "danger" | "neutral";
  };
};

export type UnderlineTabsProps = {
  tabs: Array<{ id: string; label: string }>;
  activeId: string;
  onChange: (id: string) => void;
  endSlot?: ReactNode;
};

export type SortHeaderButtonProps = {
  label: string;
  shortLabel?: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
};

export type InfoTooltipProps = {
  text: string;
  label?: string;
};
