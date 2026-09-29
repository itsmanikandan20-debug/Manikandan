// The approval gate for design changes.
// The AI can only PROPOSE changes. A proposal waits here until the user approves it
// (by clicking Apply, or by clearly saying yes). The AI has no way to approve its own
// proposal: approving is decided by this code from the user's own words or click.

/** The tool the AI uses to propose Figma changes. Nothing changes when it's called. */
export const CHANGE_TOOL = {
  name: "propose_figma_changes",
  description:
    "Propose changes to the user's Figma design. NOTHING changes when you call this: the user sees an approval card " +
    "and must approve first. After calling it, ask them briefly if they want you to apply it. " +
    "Use layer ids from the most recent Figma layer list. Positions (x, y) are relative to the same root frame as in that list. " +
    "To put a saved screenshot into Figma use place_screenshot; to move a layer (like a screenshot) beside another use place_next_to.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: 'One short plain sentence the user will see, e.g. "Reduce the gap under the title from 40 to 24".',
      },
      changes: {
        type: "array",
        description: "The changes, applied in order.",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "set_text", "set_font_size", "set_font", "set_line_height", "set_fill", "set_spacing",
                "move_by", "move_to", "resize", "set_radius", "rename", "duplicate", "group", "create_component",
                "place_screenshot", "place_next_to",
              ],
            },
            id: { type: "string", description: "Layer id, like 12:34" },
            ids: { type: "array", items: { type: "string" }, description: "Layer ids (for group)" },
            text: { type: "string", description: "New text (set_text)" },
            font_size: { type: "number" },
            font_family: { type: "string" },
            font_style: { type: "string", description: 'For example "Regular", "Medium", "Bold"' },
            line_height: { type: "number", description: "In px" },
            color: { type: "string", description: "Hex colour like #1A1A1A (set_fill; for text it's the text colour)" },
            gap: { type: "number", description: "Auto-layout gap between items (set_spacing)" },
            padding: { type: "number", description: "Same padding on all four sides (set_spacing)" },
            padding_top: { type: "number" },
            padding_right: { type: "number" },
            padding_bottom: { type: "number" },
            padding_left: { type: "number" },
            dx: { type: "number" },
            dy: { type: "number" },
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
            radius: { type: "number" },
            name: { type: "string", description: "New layer name (rename, group)" },
            capture_id: { type: "string", description: 'Screenshot to add (place_screenshot): an id like cap3, or "latest"' },
            figma_file: { type: "string", description: "place_screenshot: the Figma file the user named, if they named one. If it isn't open now, it's added the moment they open it." },
            near_id: { type: "string", description: "place_screenshot: put it beside this layer's top frame (default: the selection or the frame in view)" },
            target_id: { type: "string", description: "place_next_to: the layer to put it beside" },
            side: { type: "string", enum: ["right", "left", "below", "above"], description: "Which side (default right)" },
            gap: { type: "number", description: "Space between them in px (default 100)" },
          },
          required: ["action"],
        },
      },
    },
    required: ["summary", "changes"],
  },
};

const NEGATION = /\b(no|not|don'?t|do not|wait|stop|but|instead|actually|hold on|cancel|rather|different|except|only if|what if|why|how)\b|\?/;
const YES = /^(yes|yeah|yep|yup|ya|yah|sure|ok|okay|k|alright|all right|do it|go ahead|go for it|apply|apply it|please do|yes please|sounds good|let'?s do it|perfect|great|correct|make the change|change it|do that|please|fine|right|absolutely|definitely)\b/;
const NO = /^(no|nope|nah|not now|don'?t|do not|cancel|leave it|skip|never mind|nevermind|no thanks|stop|forget it)\b/;
// "No, make it bigger" isn't a plain no: it's a new request for the AI.
const NEW_REQUEST = /\b(make|change|try|use|set|instead|bigger|smaller|larger|more|less|increase|decrease|reduce|move|darker|lighter|\d)/;
const UNDO = /\b(undo|revert|put it back|change it back|go back to how it was|undo that|reverse that)\b/;

function normalize(text) {
  return String(text).toLowerCase().replace(/[.!,]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Reads a short reply to a waiting proposal. Returns "yes", "no", "undo" or null
 * (null = not a clear answer, so the conversation just continues).
 */
export function classifyReply(text) {
  const t = normalize(text);
  const words = t.split(" ").filter(Boolean).length;
  if (words === 0 || words > 7) return null;
  if (UNDO.test(t)) return "undo";
  if (NO.test(t)) return NEW_REQUEST.test(t) ? null : "no";
  if (YES.test(t) && !NEGATION.test(t)) return "yes";
  return null;
}
