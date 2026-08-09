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
  label: string;
  value: string;
  detail?: string;
  description?: string;
  tone?: "neutral" | "good" | "watch" | "danger";
  comparison?: {
    text: string;
    tone: "good" | "watch" | "danger" | "neutral";
  };
};
