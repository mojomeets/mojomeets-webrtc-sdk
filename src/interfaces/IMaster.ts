import { SignalingClient } from 'amazon-kinesis-video-streams-webrtc';

export interface IMaster {
  signalingClient: SignalingClient;
  peerConnectionByClientId: RTCPeerConnection;
  dataChannelByClientId: Object;
  // This streams are videos
  localStream: any;
  remoteStreams: any[];
  peerConnectionStatsInterval: any;
  // Storing input video streams comming from the function
  localView: HTMLDivElement;
  remoteView: HTMLDivElement;
  // ICE server configuration
  iceServers: Object[];
}
