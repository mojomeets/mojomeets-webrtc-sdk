import { SignalingClient } from 'amazon-kinesis-video-streams-webrtc';

export interface IViewer{
    signalingClient: SignalingClient;
    peerConnection:RTCPeerConnection;
    dataChannel:Object;
    // This streams are videos
    localStream:any;
    remoteStream: any;
    peerConnectionStatsInterval:any;
    // Storing input video streams comming from the function
    localView: HTMLDivElement, 
    remoteView: HTMLDivElement,
    // ICE server configuration
    iceServers: Object[],
}