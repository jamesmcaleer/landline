// Turns the agent's raw tool calls ("playwright___browser_click: {...}") into plain English.

import { shortUrl } from "./utils";

type Args = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const quoted = (v: unknown) => (str(v) ? `“${str(v)}”` : "");

const PHRASES: Record<string, (a: Args) => string> = {
  browser_navigate: (a) => `Opening ${shortUrl(str(a.url))}`,
  browser_navigate_back: () => "Going back a page",
  browser_snapshot: () => "Reading the page",
  browser_take_screenshot: () => "Looking at the page",
  browser_click: (a) => `Clicking ${quoted(a.element) || "on the page"}`,
  browser_hover: (a) => `Pointing at ${quoted(a.element) || "the page"}`,
  browser_type: (a) => `Typing into ${quoted(a.element) || "a field"}`,
  browser_fill_form: () => "Filling in the form",
  browser_select_option: (a) => `Choosing ${quoted(a.element) || "an option"}`,
  browser_press_key: (a) => `Pressing ${str(a.key) || "a key"}`,
  browser_wait_for: () => "Waiting for the page",
  browser_tabs: () => "Switching tabs",
  browser_evaluate: () => "Reading data from the page",
  browser_handle_dialog: () => "Answering a dialog",
  browser_file_upload: () => "Uploading a file",
  browser_network_requests: () => "Checking the site's network calls",
  browser_console_messages: () => "Checking the page console",
  request_approval: () => "Asking the caretaker to approve",
  ask_user: () => "Asking the caller a question",
  report_progress: (a) => str(a.text) || str(a.message),
  Grep: () => "Searching the site's captured data",
  Read: () => "Reading the site's captured data",
  Execute: () => "Running a script over the captured data",
};

/** Strips the MCP server prefix: "playwright___browser_click" -> "browser_click". */
export function toolName(raw: string): string {
  const i = raw.lastIndexOf("___");
  return i >= 0 ? raw.slice(i + 3) : raw;
}

function parseArgs(text: string): Args {
  try {
    return JSON.parse(text) as Args;
  } catch {
    // shortArgs() may have cut the JSON; pull out the fields we use.
    const args: Args = {};
    for (const key of ["url", "element", "key", "text"]) {
      const m = text.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)`));
      if (m) args[key] = m[1];
    }
    return args;
  }
}

/** Plain-English line for one task.step, or null for internal steps (tool search, skills). */
export function describeStep(step: string): string | null {
  const sep = step.indexOf(": ");
  const name = toolName(sep >= 0 ? step.slice(0, sep) : step);
  const phrase = PHRASES[name];
  if (!phrase) return null;
  return phrase(parseArgs(sep >= 0 ? step.slice(sep + 2) : "{}")) || null;
}

/** Short verb for an agent.action tick on the timeline. */
export function actionVerb(tool: string): string {
  return toolName(tool).replace(/^browser_/, "").replace(/_/g, " ");
}
