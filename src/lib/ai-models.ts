// Allowlisted chat models for the user-facing model picker.
// Only include ids present in the Lovable AI Gateway model catalog.

export type AiModelId =
  | "google/gemini-3-flash-preview"
  | "google/gemini-3.1-flash-lite"
  | "google/gemini-3.1-pro-preview"
  | "google/gemini-3.5-flash"
  | "google/gemini-2.5-pro"
  | "google/gemini-2.5-flash"
  | "google/gemini-2.5-flash-lite"
  | "openai/gpt-5"
  | "openai/gpt-5-mini"
  | "openai/gpt-5-nano"
  | "openai/gpt-5.2"
  | "openai/gpt-5.4"
  | "openai/gpt-5.4-mini"
  | "openai/gpt-5.4-nano"
  | "openai/gpt-5.5";

export type AiModelOption = {
  id: AiModelId;
  label: string;
  vendor: "Google" | "OpenAI";
  tier: "Flagship" | "Balanced" | "Fast";
  blurb: string;
};

export const AI_MODELS: AiModelOption[] = [
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash", vendor: "Google", tier: "Balanced", blurb: "Default. Fast preview model — great for everyday chat." },
  { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", vendor: "Google", tier: "Fast", blurb: "Cost-efficient Gemini 3.1 for high-volume chat." },
  { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash", vendor: "Google", tier: "Balanced", blurb: "High-efficiency coding & reasoning." },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", vendor: "Google", tier: "Flagship", blurb: "Next-gen Gemini reasoning when quality matters." },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", vendor: "Google", tier: "Flagship", blurb: "Strong multimodal & long-context reasoning." },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", vendor: "Google", tier: "Balanced", blurb: "Balanced Gemini with lower cost & latency than Pro." },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", vendor: "Google", tier: "Fast", blurb: "Cheapest / fastest for simple tasks." },
  { id: "openai/gpt-5", label: "GPT-5", vendor: "OpenAI", tier: "Flagship", blurb: "Powerful all-rounder for accuracy & nuance." },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini", vendor: "OpenAI", tier: "Balanced", blurb: "Lower-cost GPT-5 with strong general performance." },
  { id: "openai/gpt-5-nano", label: "GPT-5 Nano", vendor: "OpenAI", tier: "Fast", blurb: "Fastest / lowest-cost OpenAI model." },
  { id: "openai/gpt-5.2", label: "GPT-5.2", vendor: "OpenAI", tier: "Flagship", blurb: "Strong OpenAI reasoning & problem solving." },
  { id: "openai/gpt-5.4", label: "GPT-5.4", vendor: "OpenAI", tier: "Flagship", blurb: "Advanced reasoning for complex, multi-step problems." },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", vendor: "OpenAI", tier: "Balanced", blurb: "Smaller, faster GPT-5.4 with great cost/quality balance." },
  { id: "openai/gpt-5.4-nano", label: "GPT-5.4 Nano", vendor: "OpenAI", tier: "Fast", blurb: "Fastest, lowest-cost GPT-5.4 variant." },
  { id: "openai/gpt-5.5", label: "GPT-5.5", vendor: "OpenAI", tier: "Flagship", blurb: "Most capable GPT-5.5 model for demanding tasks." },
];

export const DEFAULT_MODEL: AiModelId = "openai/gpt-5.5";
const STORAGE_KEY = "qs_ai_model_v1";

export function loadModel(): AiModelId {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && AI_MODELS.some((m) => m.id === raw)) return raw as AiModelId;
  } catch {
    /* ignore */
  }
  return DEFAULT_MODEL;
}

export function saveModel(id: AiModelId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* quota */
  }
}

export function getModelById(id: string): AiModelOption | undefined {
  return AI_MODELS.find((m) => m.id === id);
}

export const ALLOWED_MODEL_IDS = new Set<string>(AI_MODELS.map((m) => m.id));
