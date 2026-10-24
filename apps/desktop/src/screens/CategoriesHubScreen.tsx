import { FocusGroup } from "@kinonyx/ui";
import { HomeChrome } from "../components/HomeChrome";
import { CategoryGroups } from "../components/CategoryBrowse";
import { useHomeFeel } from "../components/useHomeFeel";

/** "Категории" — every genre for Фильмы/Сериалы/Мультфильмы on one page, as tiles in the home page's look.
 *  Picking one opens that genre's page. */
export function CategoriesHubScreen() {
  useHomeFeel(null);

  return (
    <FocusGroup focusKey="categories-hub" className="screen-pad home home--tv home--nohero">
      <HomeChrome id="cathub" label="Категории" />
      <div className="home__rows cats">
        <CategoryGroups prefix="cathub" autoFocusFirst />
      </div>
    </FocusGroup>
  );
}
