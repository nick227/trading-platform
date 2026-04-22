# Styling conventions (work-in-progress)

Goal: keep layout and spacing controlled by tokens and shared classes, and avoid per-component one-off class names or inline styles.

## Tokens

- Source of truth: `app/src/styles/tokens/*.css`
- Prefer tokens for **color**, **space**, **radius**, **shadow**, **typography**.
- If you need a new value, add a token before adding a new hard-coded px value.

## Class layers

- Layout primitives live in `app/src/styles/layout.css`
  - Convention: prefer `l-*` for new layout classes (legacy `.page/.container/...` still exist).
- Component primitives live in `app/src/styles/components.css`
  - Shared patterns like cards, headers, KPI blocks, data rows, charts.
- Utilities live in `app/src/styles/utilities.css`
  - Token-backed one-liners (text colors, weights, margin helpers).

## JSX guidelines

- Prefer shared primitives (`.card`, `.panel-header`, `.l-grid-*`, `.btn*`) over adding new component-specific class names.
- Avoid `style={{ ... }}` in JSX except for truly dynamic values that cannot be expressed with tokens/classes.
  - If you find yourself repeating an inline style, promote it into a shared class instead.

