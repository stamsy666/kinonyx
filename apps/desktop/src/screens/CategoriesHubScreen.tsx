import { Focusable, FocusGroup } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { HomeChrome } from "../components/HomeChrome";
import { CategoryGroups } from "../components/CategoryBrowse";
import { useHomeFeel } from "../components/useHomeFeel";
import strawberry from "../assets/strawberry.webp";

/** "Категории" — every genre for Фильмы/Сериалы/Мультфильмы on one page, as tiles in the home page's look.
 *  Picking one opens that genre's page. */
export function CategoriesHubScreen() {
  useHomeFeel(null);
  const navigate = useApp((s) => s.navigate);

  return (
    <FocusGroup focusKey="categories-hub" className="screen-pad home home--tv home--nohero">
      <HomeChrome id="cathub" label="Категории" />
      <div className="home__rows cats">
        <CategoryGroups prefix="cathub" autoFocusFirst />
        <section className="cats__group">
          <h2 className="cats__title">Для взрослых</h2>
          <div className="cats__tiles">
            <Focusable as="button" className="cats__tile" focusKey="cathub:adult" onPress={() => navigate({ name: "adult" })} style={{ "--tile-hue": 345 } as React.CSSProperties}>
              <div className="cats__tile-art">
                <img src={strawberry} alt="" decoding="async" style={{ objectPosition: "center 30%", opacity: 1 }} />
              </div>
              <span className="cats__tile-name">Клубничка</span>
            </Focusable>
          </div>
        </section>
      </div>
    </FocusGroup>
  );
}
