/** The app's loading animation: four dots chasing round a square, merging into a soft blob
 *  (a "gooey" effect — see `.spinner` in theme.css and the `#kx-goo` filter in index.html).
 *  Coloured by the theme's accent, so it follows the chosen theme. */
export function Spinner() {
  return <div className="spinner" role="status" aria-hidden="true" />;
}
