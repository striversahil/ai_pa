---
description: Reverse-engineer a reference application's visual design
  language and apply it consistently to an existing application while
  preserving its product identity, information architecture, business
  logic, and functionality.
name: reference-driven-ui-ux-transformation
---

# Reference-Driven UI/UX Transformation Skill

## Mission

Transform an existing application so its visual design language is
inspired by the supplied reference screenshot: warm off-white
backgrounds, forest-green accents, sage surfaces, generous rounded
cards, soft elevation, clear typography, consistent icons, and calm,
spacious layouts.

This is a **design-system migration and UI/UX refinement**, not a
rewrite of the product. Preserve the application's purpose, data,
routes, permissions, workflows, and business logic unless the user
explicitly authorizes a functional change.

The reference screenshot is a source of visual principles---not a
template for copying domain-specific content or another product's
information architecture.

## When to use this skill

Use this skill when the user asks to: - Apply the look and feel of a
supplied screenshot to an existing application. - Extract a reusable
theme, design system, or component language from a reference. -
Standardize typography, colors, spacing, radii, shadows, icons, and UI
states. - Redesign multiple existing screens consistently without
breaking functionality. - Improve visual quality through
screenshot-based iteration.

## Core operating principles

1.  **Audit before editing.** Inspect the real repository, framework,
    routes, existing styles, shared components, and tests before
    proposing structural changes.
2.  **Preserve behavior.** Do not casually alter API calls, state
    transitions, permissions, validation, database operations, business
    rules, or navigation.
3.  **Adapt, don't clone.** Transfer visual principles to the user's
    domain. Do not copy irrelevant content, mascot, product terminology,
    or reference-specific preview controls.
4.  **Centralize design decisions.** Prefer tokens and shared components
    over scattered one-off CSS.
5.  **Respect the existing stack.** Follow current conventions and reuse
    existing libraries where sensible. Do not migrate frameworks or add
    dependencies without a concrete reason.
6.  **Design for real states.** Style loading, empty, error, disabled,
    success, hover, focus, pressed, and selected states---not just the
    happy-path screenshot.
7.  **Validate what you claim.** Only report tests, screenshot
    comparisons, and routes as verified if they were actually checked.
8.  **Prioritize accessibility and responsive behavior.** Aesthetic
    similarity must not reduce readability, keyboard support, touch
    usability, or information clarity.

## Reference design language

Treat the values below as starting estimates inferred from the
screenshot, not verified original source tokens. Inspect the image and
adjust where justified.

### Color tokens

  ------------------------------------------------------------------------
  Token                    Initial value           Intended use
  ------------------------ ----------------------- -----------------------
  `--color-background`     `#F6F7F2`               Warm off-white app/page
                                                   background

  `--color-primary`        `#365633`               Primary actions, active
                                                   navigation, key accents

  `--color-text`           `#20281F`               Main text and headings

  `--color-text-muted`     `#7C8779`               Secondary text and
                                                   labels

  `--color-surface-soft`   `#EDF3EC`               Soft sage surfaces and
                                                   selected backgrounds

  `--color-surface`        `#FFFFFF`               Cards, dialogs,
                                                   elevated surfaces

  `--color-border`         `#E5E9E0`               Subtle outlines and
                                                   dividers

  `--color-success`        `#168C6B`               Success feedback

  `--color-warning`        `#D99A2B`               Warning feedback,
                                                   adjusted for contrast

  `--color-danger`         `#C94C43`               Destructive/error
                                                   feedback, adjusted for
                                                   contrast

  `--color-info`           `#4778B8`               Informational feedback
  ------------------------------------------------------------------------

Keep semantic states distinguishable. Do not use green for every status.
Check text/background contrast rather than assuming muted colors are
accessible.

### Typography

-   Start by evaluating **Inter** for cross-platform web applications.
-   For native iOS, compare with the platform's system font; for
    Android, respect the platform's typography conventions where
    appropriate.
-   Do not assert the exact reference font from a screenshot alone.
-   Define roles, not ad hoc font sizes: display/page title, section
    heading, card heading, body, label, caption, and numeric metric.
-   Use strong hierarchy: prominent headings, medium-weight labels,
    readable body text, muted supporting text.
-   Tune font size, weight, line height, letter spacing, and wrapping
    together.
-   Avoid excessive all-caps labels, overly tight line height, and
    truncation of important data.

Suggested initial web scale (adapt to the app and viewport): - Page
title: `30–34px`, weight `700` - Section heading: `22–26px`, weight
`600` - Card heading: `18–22px`, weight `600` - Body: `16–18px`, weight
`400` - Label: `13–15px`, weight `600` - Caption: `12–14px`, weight
`400`

### Spacing and layout

Use a consistent spacing scale based on 4px increments. Initial
suggestions: - Compact gap: `4–8px` - Standard gap: `12–16px` - Group
gap: `20–24px` - Section gap: `24–32px` - Desktop page padding: usually
`24–32px` - Mobile page padding: usually `16–24px` - Card padding:
usually `20–24px`

These are not rigid rules. Dense business tables and complex forms may
need tighter spacing than a consumer wellness dashboard. Preserve task
efficiency and information density for the product's actual users.

### Shape, borders, and elevation

-   Large content cards: approximately `24–32px` radius.
-   Controls: approximately `12–18px` radius where appropriate.
-   Pill badges/chips: full pill radius.
-   Use a thin, low-contrast border where it helps separate surfaces.
-   Prefer subtle shadows, e.g. `0 4px 16px rgba(32, 40, 31, 0.06)`.
-   Avoid heavy drop shadows, excessive nested cards, and borders around
    every element.
-   Establish a small set of radius and elevation tokens; do not make
    every element identical.

### Icons

-   Prefer one consistent icon family, such as the project's current
    library or Lucide.
-   If the project already has a coherent icon system, reuse it unless
    there is a clear reason to change.
-   Standard interface icons are usually around `20–24px`; size and
    stroke should be consistent.
-   Use forest green for active/important actions and muted green-grey
    for inactive icons.
-   Use colored icon containers sparingly and consistently.
-   Do not mix arbitrary emoji, filled icons, thin outline icons, and
    multiple libraries without a deliberate design reason.
-   Never replace a recognizable action icon with a decorative symbol
    that changes meaning.
-   Preserve meaningful brand assets and product-specific illustrations
    unless the user requests otherwise.

### Components and interaction language

Apply the visual system consistently to the components that exist in the
project: - App shell, header, sidebar, and navigation - Page headings,
breadcrumbs, and section labels - Cards, metric summaries, and grouped
content - Primary, secondary, tertiary, and destructive buttons -
Inputs, selects, checkboxes, radio groups, and validation messages -
Tables, filters, pagination, sorting, and row actions - Badges, tabs,
chips, progress indicators, and tooltips - Dialogs, drawers, menus, and
popovers - Toasts, alerts, banners, and notifications - Loading
skeletons, empty states, errors, and success states

Use a consistent state vocabulary: - Default - Hover (where relevant) -
Focus-visible - Pressed/active - Selected - Disabled - Loading -
Success - Warning - Error

Do not add bottom navigation merely because it appears in the reference.
Choose navigation patterns appropriate to the existing product and its
target devices.

## Required workflow

### Phase 1 --- Repository and product audit

Before changing code:

1.  Identify the framework, package manager, build scripts, styling
    system, component library, icon library, and route structure.
2.  Inspect project documentation and repository instructions (for
    example, `README`, `AGENTS.md`, or equivalent).
3.  Locate shared layouts, tokens, components, and page-level styles.
4.  Map the main routes/screens and identify high-use workflows.
5.  Identify data-heavy screens, forms, permissions, responsive
    breakpoints, and special states.
6.  Determine which styles are global, component-level, or duplicated.
7.  Note current test commands and known baseline failures.

Produce a concise audit and a phased plan. Then proceed with
implementation unless a genuinely blocking ambiguity or destructive
decision requires user input. Do not stop after merely offering
recommendations.

### Phase 2 --- Build a screen and component inventory

Create a practical checklist of: - Routes/screens to migrate - Shared
components used by each route - Responsive variants - Loading, empty,
error, and success states - Critical workflows requiring regression
checks

Prioritize shared components and high-traffic screens first, but do not
silently omit secondary routes. If the application is large, migrate in
controlled batches and report the remaining scope accurately.

### Phase 3 --- Define design tokens

Implement tokens in the project's existing styling approach: - Color and
semantic color roles - Typography roles - Spacing scale - Radii -
Borders - Elevation/shadows - Breakpoints or responsive layout
conventions where appropriate - Focus rings and interaction states

Use CSS custom properties, theme objects, design-system variables, or
the equivalent native platform mechanism. Do not introduce a second
competing theme system.

### Phase 4 --- Refactor shared primitives

Update or create only the shared components that the application needs.
Preserve component APIs where practical to reduce regression risk.

Check: - Consistent styling across routes - Sensible variants and
semantic states - Accessible labels and focus behavior - Correct
disabled/loading behavior - Responsive sizing - Long text and overflow -
Existing event handlers and component contracts

Do not build an elaborate design system that the product does not need.
Prefer the smallest reusable system that removes meaningful
inconsistency.

### Phase 5 --- Apply the theme to actual screens

For each route: 1. Preserve the screen's purpose and necessary content.
2. Apply page background, layout margins, and hierarchy. 3. Standardize
headings, cards, controls, tables, and icons. 4. Improve alignment,
spacing, and visual grouping. 5. Ensure the most important task/action
remains easy to find. 6. Preserve information density appropriate to the
user's workflow. 7. Test narrow and wide layouts supported by the
product. 8. Check loading, empty, error, permission-denied, and
populated states where relevant.

Do not turn every layout into a dashboard or every data group into a
rounded card. Apply the design language in a way that serves each
screen.

### Phase 6 --- Screenshot-driven visual QA

When browser/device tooling is available:

1.  Run the application using its documented command.
2.  Capture the reference and implementation at comparable viewport
    sizes.
3.  Keep the same route, content state, scroll position, and device
    scale where possible.
4.  Compare:
    -   Overall background and surface contrast
    -   Content width and page margins
    -   Vertical rhythm and alignment
    -   Font scale, weight, and wrapping
    -   Card dimensions, radii, borders, and shadows
    -   Icon size, stroke, and alignment
    -   Button and input dimensions
    -   Navigation and responsive behavior
5.  Fix the largest visual differences first, then repeat.
6.  Use an image overlay or difference image if available, but use human
    review for semantic and usability differences.

Do not optimize only for raw pixel similarity. Content differences,
platform conventions, accessibility, and task-specific needs can make a
literal pixel match undesirable.

### Phase 7 --- Functional and accessibility regression

Run the relevant available checks: - Lint and type checks -
Unit/component tests - Build - End-to-end tests, if configured - Browser
interaction checks - Keyboard and focus checks - Responsive viewport
checks - Console and network error inspection where available

Verify important workflows such as authentication, navigation, form
submission, search/filtering, data updates, permissions, and error
handling.

Do not claim that a route, test, build, or workflow passed unless it was
actually exercised. Distinguish untested areas from failures.

## Technical guardrails

-   Do not replace real API data with mock values.
-   Do not remove features to make a layout simpler.
-   Do not change business rules, schemas, authorization, or backend
    behavior as part of a visual-only migration.
-   Do not rename routes or alter URL behavior without a clear
    requirement.
-   Do not rewrite the application or change frameworks without explicit
    authorization.
-   Do not add dependencies when current tooling is sufficient.
-   Do not make broad, unrelated refactors.
-   Do not hardcode repeated colors, spacing, or radii when a token is
    appropriate.
-   Do not add animations merely for decoration; respect reduced-motion
    preferences.
-   Do not rely on color alone to communicate status.
-   Do not claim pixel-perfect fidelity based on an unverified visual
    guess.
-   Keep changes scoped, reviewable, and reversible.

## Definition of done

The migration is complete only when:

-   [ ] The reference design language is expressed through centralized,
    reusable tokens.
-   [ ] Shared components use consistent typography, colors, spacing,
    shapes, and interaction states.
-   [ ] All in-scope routes have been migrated or remaining routes are
    explicitly documented.
-   [ ] Product-specific content and workflows remain intact.
-   [ ] Responsive layouts are checked at relevant viewport sizes.
-   [ ] Important loading, empty, error, disabled, and success states
    are handled.
-   [ ] Relevant tests/build checks have been run and their results
    reported accurately.
-   [ ] Screenshots have been reviewed where tooling permits.
-   [ ] Remaining visual, functional, and accessibility issues are
    documented.
-   [ ] The final summary names the actual files/components changed and
    does not overstate verification.

## Final report format

At completion, provide: 1. **Design system:** tokens and conventions
established. 2. **Implementation:** key files and shared components
changed. 3. **Coverage:** routes/screens completed and any outstanding.
4. **Behavior preservation:** workflows checked. 5. **Verification:**
commands run and their actual outcomes. 6. **Visual QA:**
screenshots/viewports compared, if available. 7. **Remaining issues:**
known gaps, risks, or follow-up work.

## First response behavior

Begin by inspecting the repository and the supplied reference image.
Summarize the existing stack and the planned migration briefly. Then
implement in controlled phases. Ask a question only when an essential
decision cannot reasonably be inferred; do not ask the user to restate
information already present in the repository or prompt.
