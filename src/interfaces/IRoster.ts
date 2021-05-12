export interface IRoster {
  [key: string]: {
    externalUserId?:string | null;
    volume: number | null;
    muted: boolean | null;
    signalStrength: number | null;
  };
}
