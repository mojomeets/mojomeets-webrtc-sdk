export interface IClient{
    signalingClient: Object,
    localView: HTMLDivElement, 
    remoteView: HTMLDivElement,
    localStream:any,
    iceServers: Object[],
    peerConnectionByClientId:Object,
    dataChannelByClientId:Object,
    peerConnectionStatsInterval:any
}