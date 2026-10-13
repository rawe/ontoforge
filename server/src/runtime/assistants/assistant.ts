/** What every assistant kind shares at runtime. */

/** One runtime list item, the same for every assistant kind. */
export interface RuntimeAssistant {
  key: string;
  name: string;
  description: string | null;
  builtIn: boolean;
}
