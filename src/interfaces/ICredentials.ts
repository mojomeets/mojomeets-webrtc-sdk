export interface ICredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  getPromise?(): Promise<void>;
  /////
  channelName: string;
  region: string;
  clientId?: string;
  systemClockOffset?: number;
  role: 'MASTER' | 'VIEWER';
  // True or False
  sendVideo: boolean;
  sendAudio: boolean;
  shareScreen: boolean;
  openDataChannel: boolean;
  widescreen: boolean;
  fullscreen: boolean;
}
