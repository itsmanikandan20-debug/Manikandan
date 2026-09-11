import type { ResponsiveFinding, Viewport } from "./types";
import { svgToDataUrl } from "./mock-page";
import { VIEWPORTS } from "./types";

// Hand-built mobile (390px) screenshot showing the two responsive bugs the
// demo calls out: the nav links running past the viewport edge (no
// hamburger menu was built for mobile) and the hero heading getting cut
// off instead of wrapping. Drawn at a wider viewBox (460) than the 390px
// frame so the overflow is visible, with a dashed red line marking the
// actual viewport edge.
function buildMobileOverflowSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="640" viewBox="0 0 460 640">
    <rect x="0" y="0" width="460" height="640" fill="#FFFFFF"/>
    <rect x="0" y="0" width="390" height="640" fill="#FFFFFF" stroke="#E7E3EE"/>

    <!-- header: nav overflows past the 390px edge -->
    <rect x="0" y="0" width="460" height="56" fill="#FFFFFF"/>
    <line x1="0" y1="56" x2="460" y2="56" stroke="#E7E3EE"/>
    <text x="20" y="34" font-size="16" font-weight="700" fill="#181321" font-family="Inter">Brandly</text>
    <text x="120" y="34" font-size="12" fill="#181321" font-family="Inter">Product</text>
    <text x="196" y="34" font-size="12" fill="#181321" font-family="Inter">Pricing</text>
    <text x="264" y="34" font-size="12" fill="#181321" font-family="Inter">About</text>
    <text x="322" y="34" font-size="12" fill="#B3403C" font-family="Inter" font-weight="700">Contact</text>
    <rect x="316" y="12" width="140" height="32" fill="none" stroke="#B3403C" stroke-width="2" stroke-dasharray="3 3"/>

    <!-- viewport edge marker -->
    <line x1="390" y1="0" x2="390" y2="640" stroke="#B3403C" stroke-width="2" stroke-dasharray="6 4"/>
    <text x="396" y="80" font-size="10" fill="#B3403C" font-family="Inter" writing-mode="tb">390px viewport edge</text>

    <!-- hero -->
    <rect x="0" y="56" width="390" height="300" fill="#FAF9FC"/>
    <text x="20" y="116" font-size="26" font-weight="700" fill="#181321" font-family="Inter">Design Faster,</text>
    <text x="20" y="150" font-size="26" font-weight="700" fill="#181321" font-family="Inter">Ship S…</text>
    <rect x="150" y="132" width="90" height="34" fill="none" stroke="#B3403C" stroke-width="2" stroke-dasharray="3 3"/>
    <text x="20" y="190" font-size="13" fill="#7A7288" font-family="Inter">Catch every visual difference</text>
    <text x="20" y="210" font-size="13" fill="#7A7288" font-family="Inter">between your Figma design…</text>
    <rect x="20" y="240" width="150" height="44" rx="4" fill="#6931CC"/>
    <text x="95" y="267" font-size="13" fill="#FFFFFF" text-anchor="middle" font-family="Inter">Start Now</text>

    <rect x="0" y="356" width="390" height="284" fill="#FFFFFF"/>
    <text x="20" y="400" font-size="12" fill="#B8B2C4" font-family="Inter">(page continues…)</text>
  </svg>`;
}

export function buildDemoResponsive(): ResponsiveFinding[] {
  const mobile: Viewport = VIEWPORTS[5]; // 390 × 844
  const dataUrl = svgToDataUrl(buildMobileOverflowSvg());

  return [
    {
      viewport: mobile,
      screenshotDataUrl: dataUrl,
      issues: [
        {
          type: "overflow",
          severity: "high",
          description:
            "The main navigation has no mobile menu — the nav links run past the right edge of the 390px viewport, causing horizontal scrolling on phones.",
          selector: "nav.main-nav",
        },
        {
          type: "text-cutoff",
          severity: "medium",
          description:
            'The hero heading "Design Faster, Ship Sooner" is clipped to "Ship S…" instead of wrapping onto a second line at this width.',
          selector: "h1.hero-heading",
        },
      ],
    },
  ];
}
