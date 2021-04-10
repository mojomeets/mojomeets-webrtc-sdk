import { SignalingClient } from 'amazon-kinesis-video-streams-webrtc';

export interface IClient{
    // Common
    signalingClient: SignalingClient;
    // This streams are videos
    localStream:any;
    peerConnectionStatsInterval:any;
    // Storing input video streams comming from the function
    localView: HTMLDivElement; 
    remoteView: HTMLDivElement;
    // ICE server configuration
    iceServers: Object[];
    // Master
    peerConnectionByClientId:RTCPeerConnection[];
    dataChannelByClientId:Object;
    remoteStreams: any[];
    // Viewer
    peerConnection:RTCPeerConnection;
    dataChannel:any;
    remoteStream: any;
}