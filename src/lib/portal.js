/**
 * Where a portalled dropdown cell's menu renders, kept free of React so it can
 * be tested on its own.
 *
 * A dropdown's menu normally renders inside its cell, so any ancestor that
 * clips or scrolls (the grid's own scroll area, a card, a modal body) cuts it
 * off. In a portal the menu is attached to the page body with fixed
 * positioning, so it can extend past those edges and sit above nearby content.
 */

/** The class on the portal's element, which the menu and option styles hang off. */
export const MENU_PORTAL_CLASS = 'drg-dropdown-menu-portal'

/**
 * Above the page's own layers. Mantine's modals sit at 200 and its popovers at
 * 300, so a grid inside either still shows its menu on top.
 */
export const MENU_PORTAL_Z_INDEX = 1000

/**
 * The react-select props that render its menu in a portal.
 *
 * @param {Element} target The element the menu is attached to, the page body.
 * @returns {object} Props to spread onto react-select's Select.
 */
export function menuPortalProps(target) {
  return {
    menuPortalTarget: target,
    menuPosition: 'fixed',
    // Opens upwards when there is no room below, as the browser would.
    menuPlacement: 'auto',
    // The page should not jump to show the menu; it is positioned to fit.
    menuShouldScrollIntoView: false,
    classNames: { menuPortal: () => MENU_PORTAL_CLASS },
  }
}

/**
 * The menu portal's style: react-select's own, raised above the page.
 *
 * @param {object} base react-select's style for the portal.
 * @returns {object} The style to use.
 */
export function menuPortalStyle(base) {
  return { ...base, zIndex: MENU_PORTAL_Z_INDEX }
}
