/* Tests of where portalled dropdown menus render: `npm run test:js`. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MENU_PORTAL_CLASS, MENU_PORTAL_Z_INDEX, menuPortalProps, menuPortalStyle } from "../portal.js";

test("the menu renders on the target with fixed positioning", () => {
  const body = { tagName: "BODY" };
  const props = menuPortalProps(body);

  assert.equal(props.menuPortalTarget, body);
  assert.equal(props.menuPosition, "fixed");
  assert.equal(props.menuPlacement, "auto");
  assert.equal(props.menuShouldScrollIntoView, false);
});

test("the portal carries the class its menu styles hang off", () => {
  assert.equal(menuPortalProps({}).classNames.menuPortal(), MENU_PORTAL_CLASS);
});

test("the portal keeps react-select's position and sits above the page", () => {
  const style = menuPortalStyle({ position: "fixed", top: 10, left: 20, zIndex: 1 });

  assert.deepEqual(style, { position: "fixed", top: 10, left: 20, zIndex: MENU_PORTAL_Z_INDEX });
  assert.ok(MENU_PORTAL_Z_INDEX > 300, "above Mantine's modals and popovers");
});
