import type { PropertyAdapter } from "../binding.ts";
import {
  backgroundImageAdapter,
  formAdapter,
  imageAdapter,
  linkAdapter,
} from "./content.ts";
import {
  appearanceAdapter,
  boxAdapter,
  layoutAdapter,
  spacingAdapter,
} from "./style.ts";
import { textAdapter, typographyAdapter } from "./text.ts";

export const builtinPropertyAdapters: readonly PropertyAdapter[] = [
  textAdapter,
  formAdapter,
  linkAdapter,
  imageAdapter,
  backgroundImageAdapter,
  typographyAdapter,
  boxAdapter,
  layoutAdapter,
  spacingAdapter,
  appearanceAdapter,
];
