import type { CSSProperties } from "vue";
import type { IconName } from "./workspace";
export type PopupSelectValue = string | number;

export interface PopupSelectOption {
  value: PopupSelectValue;
  label: string;
  group?: { key: string; label: string };
  description?: string;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
  actionIcon?: IconName;
  actionLabel?: string;
}

export interface PopupSelectProps {
  modelValue: PopupSelectValue;
  options: readonly PopupSelectOption[];
  accessibleLabel: string;
  disabled: boolean;
  placeholder: string;
  variant: "field" | "compact" | "preset" | "menu";
  size: "small" | "medium" | "large";
  align: "start" | "end";
  menuMinWidth: number;
  menuMaxHeight: number;
  menuZIndex: number;
  multiple: boolean;
  selectedValues: readonly PopupSelectValue[];
  selectedSummary?: string;
}
export interface PopupSelectEvents {
  (event: "menuNavigate", direction: 1 | -1): void;
  (event: "update:modelValue", value: PopupSelectValue): void;
  (event: "change", value: PopupSelectValue): void;
  (event: "optionAction", value: PopupSelectValue): void;
  (event: "update:selectedValues", values: PopupSelectValue[]): void;
}
