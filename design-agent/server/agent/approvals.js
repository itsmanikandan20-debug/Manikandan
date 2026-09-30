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
              type: "string", description: "One of: set_text, set_font_size, set_font, set_line_height, set_fill, set_spacing, move_by, move_to, resize, set_radius, rename, duplicate, group, create_component, place_screenshot, place_next_to"
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
            side: { type: "string", description: "Which side (default right) (one of: right, left, below, above)" },
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

/** The tool the AI uses to design new screens or wireframes. Also only a proposal. */
export const DESIGN_TOOL = {
  name: "propose_design",
  description:
    "Design a new screen, section or wireframe in the user's Figma file. NOTHING is created until the user approves. " +
    "Describe it as a flat list of layers: the first layer with no parent is the top frame; every other layer names its parent by key. " +
    "Frames are auto-layout containers. It's placed to the right of the frame they're looking at.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: 'Frame name, e.g. "Login – mobile"' },
      summary: { type: "string", description: 'Short sentence for the approval card, e.g. "Create a login screen wireframe"' },
      style: { type: "string", description: "wireframe = greyscale boxes; styled = real colours and fonts (one of: wireframe, styled)" },
      width: { type: "number", description: "Top frame width: 390 for mobile, 1440 for desktop, 768 for tablet" },
      min_height: { type: "number", description: "Optional: at least this tall (e.g. 844 for a mobile screen)" },
      font_family: { type: "string", description: "Styled only: font family (default: the file's own)" },
      near_id: { type: "string", description: "Optional: place it beside this layer's top frame" },
      nodes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "Unique short key, e.g. header, title, cta" },
            parent: { type: "string", description: "Key of the parent frame (empty for the top frame)" },
            type: { type: "string", description: "One of: frame, text, rect, image, button, input, icon, divider" },
            name: { type: "string", description: "Layer name" },
            text: { type: "string", description: "Text, button label, input placeholder or image label. Use realistic copy, not lorem ipsum." },
            direction: { type: "string", description: "Frames: stack direction (default vertical) (one of: vertical, horizontal)" },
            gap: { type: "number" },
            padding: { type: "number" },
            padding_x: { type: "number" },
            padding_y: { type: "number" },
            align: { type: "string", description: "Frames: along the stack direction (one of: start, center, end, space_between)" },
            cross_align: { type: "string", description: "Frames: across the stack direction (one of: start, center, end)" },
            width: { type: "number", description: "Fixed width in px" },
            height: { type: "number", description: "Fixed height in px" },
            fill_width: { type: "boolean", description: "Stretch to the parent's width" },
            fill_height: { type: "boolean" },
            fill: { type: "string", description: "Background colour hex" },
            text_color: { type: "string" },
            font_size: { type: "number" },
            font_weight: { type: "string", description: "One of: regular, medium, semibold, bold" },
            text_align: { type: "string", description: "One of: left, center, right" },
            radius: { type: "number" },
            stroke: { type: "string", description: "Border colour hex" },
          },
          required: ["key", "type"],
        },
      },
    },
    required: ["name", "nodes"],
  },
};
