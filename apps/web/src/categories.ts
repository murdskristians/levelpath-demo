import { PURCHASE_REQUEST_CATEGORIES, type PurchaseRequestCategory } from '@levelpath/shared';

/** What the UI shows for each category (spec A15). The values themselves live in shared. */
export const CATEGORY_LABELS: Record<PurchaseRequestCategory, string> = {
  hardware: 'Hardware',
  software: 'Software',
  office_supplies: 'Office supplies',
  services: 'Services',
  travel: 'Travel',
  other: 'Other',
};

/** The categories in their shared order, each with its label: the select's options. */
export const CATEGORY_OPTIONS = PURCHASE_REQUEST_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));
