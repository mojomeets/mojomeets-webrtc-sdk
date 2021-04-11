import { SignalingClient } from 'amazon-kinesis-video-streams-webrtc';

export interface IClient {
  // Common
  signalingClient: SignalingClient;
  // This streams are videos
  localStream: MediaStream | null;
  peerConnectionStatsInterval: any;
  // Storing input video streams comming from the function
  localView: HTMLDivElement;
  remoteView: HTMLDivElement;
  // ICE server configuration
  iceServers: object[];
  // Master
  peerConnectionByClientId: RTCPeerConnection[];
  dataChannelByClientId: object;
  remoteStreams: MediaStream[];
  // Viewer
  peerConnection: RTCPeerConnection;
  dataChannel: any;
  remoteStream: MediaStream | null;
}
