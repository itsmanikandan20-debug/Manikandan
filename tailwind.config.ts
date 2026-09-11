import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#181321",
          soft: "#413A4D",
          muted: "#7A7288",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          sunken: "#FAF9FC",
          raised: "#FFFFFF",
        },
        border: {
          DEFAULT: "#E7E3EE",
          strong: "#D6D0E3",
        },
        violet: {
          50: "#F5F2FD",
          100: "#ECE6FB",
          200: "#D9CDF6",
          300: "#BCA5EF",
          400: "#9A75E5",
          500: "#7C4EDB",
          600: "#6931CC",
          700: "#5723A8",
          800: "#461D87",
          900: "#3A1B6C",
        },
        signal: {
          match: "#2F6FED",
          identified: "#7C4EDB",
          verified: "#1D9A6C",
          unverified: "#B8860F",
          notfound: "#B3403C",
        },
        severity: {
          high: "#E4342A",
          "high-bg": "#FDECEC",
          medium: "#C4790A",
          "medium-bg": "#FBF0DF",
          low: "#2F6FED",
          "low-bg": "#EBF1FE",
        },
        status: {
          open: "#7A7288",
          "open-bg": "#F1EFF6",
          approved: "#1D9A6C",
          "approved-bg": "#E5F6EE",
          rejected: "#B3403C",
          "rejected-bg": "#FBEAE9",
          fixed: "#2F6FED",
          "fixed-bg": "#EBF1FE",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
      borderRadius: {
        xl: "14px",
        "2xl": "20px",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(24, 19, 33, 0.04), 0 8px 24px -12px rgba(24, 19, 33, 0.10)",
        pop: "0 2px 6px rgba(24, 19, 33, 0.06), 0 16px 32px -16px rgba(105, 49, 204, 0.22)",
      },
      maxWidth: {
        content: "1180px",
      },
    },
  },
  plugins: [],
};

export default config;
