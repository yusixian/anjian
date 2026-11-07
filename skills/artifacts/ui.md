# UI components

HTML artifacts can use a small set of Lobe UI components through Web
Components. The artifacts server loads the runtime automatically when the page
contains a `<anjian-…>` element:

```html
<anjian-button variant="primary">Save</anjian-button>
```

No script tag is needed. If you create components dynamically, add
`<meta name="anjian-ui" content="1">` to the page so the runtime is loaded.

The runtime loads with `defer`. A page script that needs the components should
wait for the document event:

```js
document.addEventListener(
  'anjian-ui:ready',
  () => {
    // custom elements are defined
  },
  { once: true },
);
```

Use these for controls and basic display. Use plain HTML and CSS for layout;
there is no layout wrapper to learn.

## Rules

- Give every interactive control a stable `id`. The viewer restores custom
  controls across rewrites by `id`, the same way it restores native inputs.
- Listen for `anjian-change` on controls:

  ```js
  document.addEventListener('anjian-change', (event) => {
    const { value, checked } = event.detail;
    console.log(event.target.id, value, checked);
  });
  ```

  It bubbles. `value` is a string, number, boolean, or `null`; `checked` is
  present for checkboxes and switches.

- `value` / `checked` attributes set the initial state. Read the current state
  from the element's `value` / `checked` property after `anjian-ui:ready`, and
  listen for `anjian-change` for later updates.
- `class` styles the host; `style` is forwarded to the component as well, so
  `style="width:100%"` works. Style the host, not the component's internal
  classes.
- Keep children simple. For `anjian-button`, `anjian-card`, `anjian-text`,
  `anjian-tag`, `anjian-checkbox`, and `anjian-badge`, the original children are
  moved into the component. `anjian-select`, `anjian-segmented`, and
  `anjian-radio-group` use option children instead.
- Do not invent a `anjian-` tag. If a component is not listed here, use HTML.
- `anjian-card` already paints a surface. Do not put a background, border and
  padding on both the host and the card: pick one. For a floating panel,
  either position the host and let the card paint its own surface, or make the
  host the surface and use `variant="borderless"` without `glass`/`shadow`.
- Components follow `prefers-color-scheme`. Set `<html data-theme="light">`
  or `data-theme="dark"` before the runtime loads to pin the whole page.
  Without an explicit theme, the runtime follows OS theme changes.
  Lobe tokens such as `--lobe-color-primary` can be overridden on the host or
  page.

## Controls

### Button

```html
<anjian-button variant="primary" size="middle" icon="plus">Add</anjian-button>
<anjian-button variant="outlined" loading>Working…</anjian-button>
```

Attributes: `variant` (`filled`, `outlined`, `borderless`), `size`
(`small`, `middle`, `large`), `block`, `loading`, `disabled`, `shape`, `type`,
`icon` (any Lucide kebab-case name; `refresh` and `trash` remain aliases).
See [icons.md](./icons.md) for standalone icons and mapping the preview's
actions to business icons when implementing the app.

Uses the native `click` event.

### Action icon

```html
<anjian-action-icon icon="settings" title="Settings" aria-label="Settings"></anjian-action-icon>
```

Attributes: `icon` (same set as Button), `size`, `disabled`, `title`,
`aria-label`. Uses the native `click` event.

### Tooltip and popover

```html
<anjian-tooltip content="Copy a private link" placement="top">
  <anjian-icon name="copy" size="14"></anjian-icon> Copy
</anjian-tooltip>
<anjian-popover id="sharing" content="Only people you invite can open this link.">
  Sharing details
</anjian-popover>
```

Both provide a native button trigger; children are its label and decorative
icons, not nested buttons or controls. `content` is plain text, `placement`
sets the floating position. Tooltip opens on hover/focus; Popover opens on
click (`trigger="hover"` opts into hover). Tooltip also accepts `open` for
a controlled preview. Native trigger clicks still reach your handlers.

### Action menu

```html
<anjian-menu id="actions" label="More" icon="ellipsis">
  <anjian-menu-item value="copy" icon="copy">Copy link</anjian-menu-item>
  <anjian-menu-item value="delete" icon="trash-2" disabled>Delete</anjian-menu-item>
</anjian-menu>
```

Attributes: `label`, `icon`, `placement`, `disabled`. Items accept `value`,
`icon`, `disabled`; their text is the label. Selecting an enabled item emits
`anjian-change` with its action in `event.detail.value`. Actions are not
restored as control values on reload.

### Input

```html
<anjian-input id="title" placeholder="Title" value="Anjian" style="width:100%"></anjian-input>
```

Attributes: `type`, `size` (`small`, `middle`, `large`), `variant`
(`filled`, `outlined`, `borderless`), `allowClear`, `placeholder`, `value`,
`disabled`, `name`, `aria-label`.

### Textarea

```html
<anjian-textarea id="notes" rows="4" placeholder="Notes" style="width:100%"></anjian-textarea>
```

Attributes: `rows`, `size`, `variant`, `placeholder`, `value`, `disabled`,
`name`.

### Number

```html
<anjian-input-number id="count" value="12" min="0" max="100" step="1"></anjian-input-number>
```

Attributes: `value`, `min`, `max`, `step`, `precision`, `controls`, `size`,
`variant`, `placeholder`, `disabled`.

### Slider

```html
<anjian-slider id="size" value="32" min="0" max="100" step="1"></anjian-slider>
```

Attributes: `value`, `min`, `max`, `step`, `disabled`.

### Slider with number input

The most useful control for tuning an exact value.

```html
<anjian-slider-input id="radius" value="8" min="0" max="32" step="1"></anjian-slider-input>
```

Attributes: `value`, `min`, `max`, `step`, `controls`, `size`, `variant`,
`disabled`.

### Switch

```html
<anjian-switch id="dark" checked></anjian-switch>
```

Attributes: `checked`, `loading`, `size`, `disabled`, `name`.

### Checkbox

```html
<anjian-checkbox id="compact">Compact</anjian-checkbox>
```

Attributes: `checked`, `shape`, `size`, `disabled`, `name`. Children are the
label.

### Segmented

```html
<anjian-segmented id="mode" value="grid">
  <anjian-segment value="list">List</anjian-segment>
  <anjian-segment value="grid">Grid</anjian-segment>
  <anjian-segment value="masonry">Masonry</anjian-segment>
</anjian-segmented>
```

Attributes: `value`, `size` (`small`, `middle`, `large`), `variant`
(`filled`, `outlined`), `block`, `glass`, `shadow`, `vertical`, `disabled`.

### Select

```html
<anjian-select id="layout" value="a" placeholder="Choose layout">
  <anjian-option value="a">Sidebar</anjian-option>
  <anjian-option value="b">Top tabs</anjian-option>
  <anjian-option value="c">Bottom rail</anjian-option>
</anjian-select>
```

Attributes: `value`, `placeholder`, `size`, `variant`, `allowClear`,
`showSearch`, `loading`, `mode` (`multiple`, `tags`), `disabled`.

### Radio group

```html
<anjian-radio-group id="density" value="comfortable">
  <anjian-radio value="compact">Compact</anjian-radio>
  <anjian-radio value="comfortable">Comfortable</anjian-radio>
  <anjian-radio value="spacious">Spacious</anjian-radio>
</anjian-radio-group>
```

Attributes: `value`, `horizontal`, `gap`, `size`, `disabled`.

### Colour picker

```html
<anjian-color-picker id="accent" value="#c56473" trigger="field"></anjian-color-picker>
```

Attributes: `value`, `alpha`, `defaultFormat` (`hex`, `rgb`, `hsl`),
`trigger` (`swatch`, `field`, `chip`), `size`, `disabled`.

## Display

### Toast

HTML artifacts can call the bundled Lobe UI toast API as `window.anjianToast`.
If the page has no `anjian-` UI controls, opt in with the meta tag. Wait for
`anjian-ui:ready` before calling it:

```html
<meta name="anjian-ui" content="1" />
<button id="save" type="button">Save</button>
<script>
  document.addEventListener(
    'anjian-ui:ready',
    () => {
      document.getElementById('save').addEventListener('click', async () => {
        try {
          await saveDraft(); // the page's own operation
          window.anjianToast.success({ id: 'save-result', title: 'Saved' });
        } catch {
          window.anjianToast.error({
            id: 'save-result',
            title: 'Save failed',
            description: 'Try again.',
          });
        }
      });
    },
    { once: true },
  );
</script>
```

Methods: `success`, `error`, `info`, `warning`, `loading`. Each takes a string
message or `{ title, description, id, duration }`. Text is rendered as text,
not HTML. A stable `id` refreshes the same notification instead of stacking
copies. The default duration is 5000ms; `duration: 0` stays until closed.
`loading` stays until closed by default.

Calls return a handle with `id` and `close()`. Use
`window.anjianToast.dismiss(id)` to close one, or `dismiss()` to close all.
Toasts appear at the bottom right and follow the page's theme. They are
transient: rewriting the page does not restore them. No `anjian-toast` tag is
needed. Artboard pages do not load this UI runtime.

### Tag

```html
<anjian-tag variant="outlined">New</anjian-tag>
```

Attributes: `variant` (`filled`, `outlined`, `borderless`, `solid`), `size`,
`shape` (`normal`, `round`), `color`, `closable`.

### Alert

```html
<anjian-alert
  type="info"
  title="Streaming"
  description="Pending boards draw as skeletons."
></anjian-alert>
```

Attributes: `type` (`success`, `info`, `warning`, `error`, `secondary`),
`variant` (`soft`, `outlined`, `plain`), `title`, `description`, `showIcon`,
`closable`. Text children are used as the title when `title` is absent.

### Progress

```html
<anjian-progress percent="64" size="small"></anjian-progress>
```

Attributes: `percent`, `size`, `status`.

### Badge

```html
<anjian-badge count="3" status="processing"></anjian-badge>
<anjian-badge count="3">
  <anjian-avatar src="avatar.png" alt="Innei" size="32"></anjian-avatar>
</anjian-badge>
```

Attributes: `count`, `dot`, `status`, `text`, `showZero`, `size`, `color`.

### Avatar

```html
<anjian-avatar src="avatar.png" alt="Innei" size="32"></anjian-avatar>
```

Attributes: `src`, `alt`, `size`, `shape`.

### Divider

```html
<anjian-divider dashed></anjian-divider>
```

Attributes: `orientation`, `dashed`.

### Card

```html
<anjian-card variant="outlined" shadow>
  <anjian-text strong>Header</anjian-text>
  <anjian-text type="secondary">Supporting copy.</anjian-text>
</anjian-card>
```

Attributes: `variant` (`filled`, `outlined`, `borderless`), `shadow`,
`glass`, `clickable`. Children are preserved, including nested components.
`glass`, `shadow` and `variant` paint the inner Block surface, not the host.
If the host supplies the panel background and padding, omit `glass`/`shadow`
and use `variant="borderless"` so there is only one visible container.

### Text

```html
<anjian-text type="secondary">Secondary body text</anjian-text>
<anjian-text strong>Strong label</anjian-text>
<anjian-text code>const x = 1</anjian-text>
```

Attributes: `type` (`secondary`, `success`, `warning`, `danger`, `info`),
`strong`, `code`, `italic`, `underline`, `delete`, `mark`, `align`, `weight`.

## Complete tuning panel

```html
<anjian-card>
  <anjian-text strong>Header</anjian-text>
  <anjian-text type="secondary">Tune the reading column.</anjian-text>

  <anjian-slider-input id="measure" value="64" min="40" max="90" step="1"></anjian-slider-input>

  <anjian-segmented id="density" value="comfortable">
    <anjian-segment value="compact">Compact</anjian-segment>
    <anjian-segment value="comfortable">Comfortable</anjian-segment>
    <anjian-segment value="spacious">Spacious</anjian-segment>
  </anjian-segmented>

  <anjian-switch id="dark"></anjian-switch>
  <anjian-tag>Live preview</anjian-tag>
</anjian-card>

<script>
  document.addEventListener('anjian-change', (event) => {
    document.body.dataset[event.target.id] = event.detail.value;
  });
</script>
```

## Not included in the first version

Tabs, Modal, Drawer, Table, DatePicker, and layout
components. Use plain HTML/CSS or a later component if one is added.
