import { Composition } from "remotion";
import {
  DURATION,
  FPS,
  HEIGHT,
  ShuttleStormRegister,
  WIDTH,
} from "./ShuttleStormRegister";

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
    </>
  );
};
