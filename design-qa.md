# Configuration Dialog Design QA

## References

- Light: `/Users/ikiru/.codex-p/attachments/02f24daf-49dd-4198-a4e3-8f6b530f74f8/image-1.png`
- Dark: `/Users/ikiru/.codex-p/attachments/02f24daf-49dd-4198-a4e3-8f6b530f74f8/image-2.png`
- Proxy service list: `/var/folders/l_/t6s5llpx7xd8d3kdn61qq0pc0000gn/T/codex-clipboard-37f21496-6067-4632-9cb2-12fdabfd1728.png`
- QA viewport: 950 x 760 logical pixels, macOS Retina capture

## Visual Checks

| Surface | Theme | Result | Evidence |
| --- | --- | --- | --- |
| Workspace configuration | Light | PASS | `design-previews/qa/workspace-config-light-comparison.png` |
| Workspace configuration | Dark | PASS | `design-previews/qa/workspace-config-dark-comparison.png` |
| Proxy configuration | Light | PASS | `design-previews/qa/proxy-config-light.png` |
| Proxy configuration | Dark | PASS | `design-previews/qa/proxy-config-dark.png` |

The comparison images place the supplied reference and the implementation in the same image. The final dark comparison was captured after correcting the dialog-scoped primary color, close affordance, and compact selector arrow.

## Acceptance Notes

- PASS: title, subtitle, icon tile, close affordance, two-column hierarchy, field density, chips, nested panels, and fixed action area follow the references.
- PASS: workspace and proxy dialogs use the same 860 x 620 maximum frame and remain centered.
- PASS: both columns have independent bounded scrolling; the footer remains visible.
- PASS: light and dark themes preserve contrast and use dialog-scoped primary color tokens.
- PASS: proxy service items use separated card spacing, compact internal padding, restrained shadows, and a blue selected accent without reducing the sidebar to oversized cards.
- PASS: narrow viewports collapse to one column without horizontal overflow.
- Intentional difference: the reference nearly fills its canvas, while the implementation keeps about 48 px horizontal and 52 px vertical minimum clearance in the default app window, matching the product requirement that configuration dialogs must not occupy the whole app.

## Verification

- `npm run web:test`: 8 files, 49 tests passed.
- `npm run web:build`: TypeScript and Vite production build passed.
