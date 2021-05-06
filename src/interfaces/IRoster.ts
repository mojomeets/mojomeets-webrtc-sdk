export interface IRoster {
  [key: string]: {
    volume: number | null;
    muted: boolean | null;
    signalStrength: number | null;
    play: (videoElement: HTMLVideoElement) => void;
  };
}
