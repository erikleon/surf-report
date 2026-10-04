// Page renderers. Each takes the site model and a context from the server and
// returns a full HTML document.

export type { PageAssets, PageContext } from "./context.js";
export { renderAbout } from "./about.js";
export { renderHome } from "./home.js";
export { renderNotFound, renderUnavailable } from "./simple.js";
export { renderWeek } from "./week.js";
