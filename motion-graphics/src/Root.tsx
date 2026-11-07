import { Composition } from "remotion";
import {
  DURATION,
  FPS,
  HEIGHT,
  ShuttleStormRegister,
  WIDTH,
} from "./ShuttleStormRegister";
import { PROMO, ShuttleStormPromo } from "./ShuttleStormPromo";
import { SPONSORS, ShuttleStormSponsors } from "./ShuttleStormSponsors";
import { PLAYERS, ShuttleStormPlayers } from "./ShuttleStormPlayers";
import { WEBSITE, ShuttleStormWebsite } from "./ShuttleStormWebsite";

const VIDEOS = [
  { id: "ShuttleStormPromo", component: ShuttleStormPromo, spec: PROMO },
  { id: "ShuttleStormSponsors", component: ShuttleStormSponsors, spec: SPONSORS },
  { id: "ShuttleStormPlayers", component: ShuttleStormPlayers, spec: PLAYERS },
  { id: "ShuttleStormWebsite", component: ShuttleStormWebsite, spec: WEBSITE },
];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ShuttleStormRegister"
        component={ShuttleStormRegister}
        durationInFrames={DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
      {VIDEOS.map((v) => (
        <Composition
          key={v.id}
          id={v.id}
          component={v.component}
          durationInFrames={v.spec.duration}
          fps={FPS}
          width={v.spec.width}
          height={v.spec.height}
        />
      ))}
    </>
  );
};
